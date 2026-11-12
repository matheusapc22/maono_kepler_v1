import {createHash} from 'node:crypto';
import {TABLE_COLUMNS, INDEX_DESCRIPTORS} from './deletion-semantic-targets.mjs';

// Diagnostic syntax recognition only. Never used as an approval/compatibility decision.
export const SEMANTIC_LIMITS = Object.freeze({bytes:32768,tokens:4096,depth:32,items:128});
const hash = text => createHash('sha256').update(text).digest('hex');
const reject = () => {throw new Error('UNSUPPORTED_DEFINITION');};
const types = new Set(['INTEGER','INT','REAL','TEXT','BLOB','NUMERIC','BOOLEAN','TIMESTAMP','DATETIME']);
const collations = new Set(['BINARY','NOCASE','RTRIM']);
const conflicts = new Set(['ROLLBACK','ABORT','FAIL','IGNORE','REPLACE']);
const foreignTables = new Set(['users','projects','organizations','tickets']);

// Sequential scanner: comments and quoted contents are never stripped or regex-rewritten.
function tokenize(sql){
  if(typeof sql!=='string'||Buffer.byteLength(sql,'utf8')>SEMANTIC_LIMITS.bytes||/[^\x09\x0a\x0d\x20-\x7e]/.test(sql))reject();
  const out=[];let i=0;
  const add=(kind,value)=>{if(out.length>=SEMANTIC_LIMITS.tokens)reject();out.push({kind,value});};
  while(i<sql.length){
    const c=sql[i];
    if(/\s/.test(c)){i++;continue;}
    if(sql.startsWith('--',i)){i+=2;while(i<sql.length&&!['\r','\n'].includes(sql[i]))i++;continue;}
    if(sql.startsWith('/*',i)){const end=sql.indexOf('*/',i+2);if(end<0)reject();i=end+2;continue;}
    if(c==="'"||c==='"'||c==='`'||c==='['){
      const end=c==='['?']':c;let value='';i++;let closed=false;
      while(i<sql.length){
        if(sql[i]===end){
          if(c!=='['&&sql[i+1]===end){value+=end;i+=2;continue;}
          i++;closed=true;break;
        }
        value+=sql[i++];
      }
      if(!closed)reject();
      add(c==="'"?'literal':'identifier',value);continue;
    }
    if(/[A-Za-z_]/.test(c)){
      const start=i++;while(i<sql.length&&/[A-Za-z_0-9]/.test(sql[i]))i++;
      add('word',sql.slice(start,i));continue;
    }
    if(/[0-9]/.test(c)){
      const m=/^(?:\d+(?:\.\d*)?)(?:[eE][+-]?\d+)?/.exec(sql.slice(i));
      if(!m)reject();i+=m[0].length;add('number',m[0]);continue;
    }
    const op=['<=','>=','<>','!=','=='].find(x=>sql.startsWith(x,i));
    if(op){add('symbol',op);i+=op.length;continue;}
    if('(),;=<>+-'.includes(c)){add('symbol',c);i++;continue;}
    reject();
  }
  return out;
}

class Parser {
  constructor(tokens,object){this.t=tokens;this.i=0;this.depth=0;this.object=object;this.opaque=0;this.columns=new Set(TABLE_COLUMNS[object.tbl_name]||INDEX_DESCRIPTORS[object.name]?.columns||[]);}
  peek(v){const t=this.t[this.i];return !!t&&((t.kind==='word'&&t.value.toUpperCase()===v)||(t.kind==='symbol'&&t.value===v));}
  take(v){if(this.peek(v)){this.i++;return true;}return false;}
  need(v){if(!this.take(v))reject();}
  enter(fn){if(++this.depth>SEMANTIC_LIMITS.depth)reject();try{return fn();}finally{this.depth--;}}
  id(allowed){const t=this.t[this.i++];if(!t||!['word','identifier'].includes(t.kind))reject();const name=t.value.toLowerCase();if(!/^[a-z_][a-z_0-9]{0,127}$/.test(name)||!allowed.has(name))reject();return name;}
  enum(values){const t=this.t[this.i++];if(!t||t.kind!=='word'||!values.has(t.value.toUpperCase()))reject();return t.value.toUpperCase();}
  list(fn){const values=[fn()];while(this.take(',')){if(values.length>=SEMANTIC_LIMITS.items)reject();values.push(fn());}return values;}
  literal(){const t=this.t[this.i];if(!t||!['literal','number'].includes(t.kind))reject();this.i++;this.opaque++;return {kind:'opaque-literal',type:t.kind==='number'?'number':'text',digest:hash(t.kind+':'+t.value)};}
  atom(){return this.enter(()=>{
    if(this.take('(')){const expression=this.expr();this.need(')');return {kind:'group',expression};}
    if(this.take('NULL'))return {kind:'null'};
    if(this.take('CURRENT_TIMESTAMP'))return {kind:'current-time',value:'CURRENT_TIMESTAMP'};
    if(this.take('CURRENT_DATE'))return {kind:'current-time',value:'CURRENT_DATE'};
    if(this.take('CURRENT_TIME'))return {kind:'current-time',value:'CURRENT_TIME'};
    if(['literal','number'].includes(this.t[this.i]?.kind))return this.literal();
    if(this.peek('+')||this.peek('-')){const operator=this.t[this.i++].value;if(this.t[this.i]?.kind!=='number')reject();return {kind:'signed',operator,value:this.literal()};}
    // Quoted expression atoms may trigger SQLite DQS string fallback; unsupported.
    if(this.t[this.i]?.kind!=='word')reject();
    return {kind:'column',name:this.id(this.columns)};
  });}
  comparison(){let left=this.atom();
    if(this.take('IS')){const negated=this.take('NOT');this.need('NULL');return {kind:'is-null',negated,value:left};}
    const negated=this.take('NOT');
    if(this.take('IN')){this.need('(');const values=this.list(()=>this.atom());this.need(')');return {kind:'in',negated,value:left,values};}
    if(negated)reject();
    const op=this.t[this.i];if(op?.kind==='symbol'&&['=','==','!=','<>','<','>','<=','>='].includes(op.value)){this.i++;left={kind:'comparison',operator:op.value,left,right:this.atom()};}
    return left;
  }
  unary(){return this.enter(()=>this.take('NOT')?{kind:'not',value:this.unary()}:this.comparison());}
  and(){let value=this.unary(),n=0;while(this.take('AND')){if(++n>=SEMANTIC_LIMITS.depth)reject();value={kind:'and',left:value,right:this.unary()};}return value;}
  expr(){let value=this.and(),n=0;while(this.take('OR')){if(++n>=SEMANTIC_LIMITS.depth)reject();value={kind:'or',left:value,right:this.and()};}return value;}
  conflict(){if(!this.take('ON'))return null;this.need('CONFLICT');return this.enum(conflicts);}
  key(){const name=this.id(this.columns);let collation=null,direction=null;if(this.take('COLLATE'))collation=this.enum(collations);if(this.peek('ASC')||this.peek('DESC'))direction=this.t[this.i++].value.toUpperCase();return {name,collation,direction};}
  keys(){this.need('(');const keys=this.list(()=>this.key());this.need(')');return keys;}
  references(){const table=this.id(foreignTables);this.need('(');const columns=this.list(()=>this.id(new Set(['id'])));this.need(')');const actions={};let match=null,deferrability=null;
    while(this.take('ON')){const event=this.enum(new Set(['DELETE','UPDATE']));if(actions[event])reject();let action;
      if(this.take('SET'))action='SET '+this.enum(new Set(['NULL','DEFAULT']));
      else if(this.take('NO')){this.need('ACTION');action='NO ACTION';}
      else action=this.enum(new Set(['CASCADE','RESTRICT']));actions[event]=action;
    }
    if(this.take('MATCH'))match=this.enum(new Set(['SIMPLE','FULL','PARTIAL']));
    if(this.peek('NOT')&&this.t[this.i+1]?.kind==='word'&&this.t[this.i+1].value.toUpperCase()==='DEFERRABLE'){this.i+=2;deferrability={deferrable:false,initially:null};}
    else if(this.take('DEFERRABLE'))deferrability={deferrable:true,initially:null};
    if(this.take('INITIALLY')){if(!deferrability)reject();deferrability.initially=this.enum(new Set(['DEFERRED','IMMEDIATE']));}
    return {kind:'references',table,columns,actions,match,deferrability};
  }
  constraint(tableLevel){
    if(this.take('PRIMARY')){this.need('KEY');const keys=tableLevel?this.keys():null;let direction=null;if(!tableLevel&&(this.peek('ASC')||this.peek('DESC')))direction=this.t[this.i++].value.toUpperCase();const conflict=this.conflict();const autoincrement=!tableLevel&&this.take('AUTOINCREMENT');return {kind:'primary-key',keys,direction,conflict,autoincrement};}
    if(this.take('UNIQUE')){const keys=tableLevel?this.keys():null;return {kind:'unique',keys,conflict:this.conflict()};}
    if(this.take('CHECK')){this.need('(');const expression=this.expr();this.need(')');return {kind:'check',expression};}
    if(tableLevel){this.need('FOREIGN');this.need('KEY');this.need('(');const columns=this.list(()=>this.id(this.columns));this.need(')');this.need('REFERENCES');return {kind:'foreign-key',columns,reference:this.references()};}
    if(this.take('NOT')){this.need('NULL');return {kind:'not-null',conflict:this.conflict()};}
    if(this.take('NULL'))return {kind:'null',conflict:this.conflict()};
    if(this.take('COLLATE'))return {kind:'collate',collation:this.enum(collations)};
    if(this.take('REFERENCES'))return this.references();
    if(this.take('DEFAULT')){
      // Bare identifiers are not accepted as default strings (SQLite legacy quoting).
      const start=this.i;const expression=this.atom();
      if(JSON.stringify(expression).includes('"kind":"column"'))reject();
      if(start===this.i)reject();return {kind:'default',expression};
    }
    reject();
  }
  table(){this.need('TABLE');const name=this.id(new Set([this.object.name]));this.need('(');const items=[];const seen=new Set();
    do{
      if(items.length>=SEMANTIC_LIMITS.items)reject();
      if(['PRIMARY','UNIQUE','CHECK','FOREIGN'].some(k=>this.peek(k)))items.push(this.constraint(true));
      else {const column=this.id(this.columns);if(seen.has(column))reject();seen.add(column);const type=this.enum(types);const constraints=[];while(!this.peek(',')&&!this.peek(')')){if(constraints.length>=SEMANTIC_LIMITS.items)reject();const next=this.constraint(false);if(constraints.some(c=>c.kind===next.kind)||(next.kind==='null'&&constraints.some(c=>c.kind==='not-null'))||(next.kind==='not-null'&&constraints.some(c=>c.kind==='null')))reject();constraints.push(next);}items.push({kind:'column',name:column,type,constraints});}
    }while(this.take(','));
    this.need(')');const flattened=items.flatMap(x=>x.kind==='column'?x.constraints:[x]);if(flattened.filter(x=>x.kind==='primary-key').length>1)reject();const tableConstraints=items.filter(x=>x.kind!=='column').map(x=>JSON.stringify(x));if(new Set(tableConstraints).size!==tableConstraints.length)reject();const options=[];
    if(this.peek('STRICT')||this.peek('WITHOUT')){
      do{let option;if(this.take('STRICT'))option='STRICT';else{this.need('WITHOUT');this.need('ROWID');option='WITHOUT ROWID';}if(options.includes(option))reject();options.push(option);}while(this.take(','));
    }
    return {kind:'table',name,items,options};
  }
  index(){const unique=this.take('UNIQUE');this.need('INDEX');const name=this.id(new Set([this.object.name]));this.need('ON');const table=this.id(new Set([this.object.tbl_name]));const keys=this.keys();const predicate=this.take('WHERE')?this.expr():null;return {kind:'index',name,table,unique,keys,predicate};}
  parse(){this.need('CREATE');const ast=this.object.type==='table'?this.table():this.index();this.take(';');if(this.i!==this.t.length)reject();return ast;}
}
export function recognizeDefinition(object){
  const target=object?.type==='table'?Object.hasOwn(TABLE_COLUMNS,object?.name||''):object?.type==='index'&&Object.hasOwn(INDEX_DESCRIPTORS,object?.name||'');
  if(!target)return {status:'out-of-scope',semanticApproval:false,authorizationEffect:'none'};
  if(object.tbl_name!==(object.type==='table'?object.name:INDEX_DESCRIPTORS[object.name].table))return {status:'unsupported',reason:'UNSUPPORTED_DEFINITION',semanticApproval:false,authorizationEffect:'none'};
  try{const parser=new Parser(tokenize(object.sql),object);const ast=parser.parse();const pending=[[ast,0]];let nodes=0;while(pending.length){const [node,depth]=pending.pop();if(++nodes>SEMANTIC_LIMITS.tokens||depth>SEMANTIC_LIMITS.depth)reject();if(node&&typeof node==='object')for(const value of Object.values(node))if(value&&typeof value==='object')pending.push([value,depth+1]);}return {status:'recognized-subset',semanticApproval:false,authorizationEffect:'none',reviewRequired:true,opaqueLiteralCount:parser.opaque,ast};}
  catch{return {status:'unsupported',reason:'UNSUPPORTED_DEFINITION',semanticApproval:false,authorizationEffect:'none'};}
}
export function semanticDiagnostics(objects){
  const targets=[...Object.keys(TABLE_COLUMNS),...Object.keys(INDEX_DESCRIPTORS)];
  return {version:1,purpose:'diagnostic-only',authorizationEffect:'none',compatibilityAuthority:false,objects:targets.map(name=>{
    const found=objects.filter(o=>o.name===name);return {name,definitionDigest:found.length===1&&typeof found[0].sql==='string'?hash(found[0].sql):null,...(found.length===1?recognizeDefinition(found[0]):{status:found.length?'unsupported':'absent',semanticApproval:false,authorizationEffect:'none'})};
  })};
}
