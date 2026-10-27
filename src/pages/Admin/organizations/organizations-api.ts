import { parseResponseJson } from '../../../lib/api-transport';
export class ManagementApiError extends Error {
  readonly status:number; readonly code:string; readonly reference?:string;
  constructor(message:string,status:number,code:string,reference?:string){super(message);this.name='ManagementApiError';this.status=status;this.code=code;this.reference=reference;}
}
const BASE='/api/admin/organization-management';
export async function api<T>(path:string,options:{signal?:AbortSignal;body?:unknown;key?:string}={}):Promise<T>{
  const response=await fetch(`${BASE}${path}`,{method:options.body===undefined?'GET':'POST',credentials:'include',signal:options.signal,
    headers:{Accept:'application/json',...(options.body===undefined?{}:{'Content-Type':'application/json','X-Maono-Management':'1'}),...(options.key?{'Idempotency-Key':options.key}:{})},
    body:options.body===undefined?undefined:JSON.stringify(options.body)});
  const parsed=await parseResponseJson(response);
  const data=parsed.valid?parsed.data as {ok?:boolean;error?:{message?:string;code?:string;requestId?:string}}:null;
  if(!response.ok||data?.ok!==true) throw new ManagementApiError(data?.error?.message||'Não foi possível confirmar a operação.',response.status,data?.error?.code||'MANAGEMENT_RESPONSE_INVALID',data?.error?.requestId);
  return data as T;
}
export function errorText(error:unknown){return error instanceof Error?error.message:'Não foi possível concluir a operação.';}
export function denied(error:unknown){return error instanceof ManagementApiError&&[401,403,404].includes(error.status);}
export function dateLabel(value:string|null){if(!value)return 'Sem registro';const date=new Date(value.includes('T')?value:`${value.replace(' ','T')}Z`);return Number.isNaN(date.getTime())?'Sem registro':new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(date);}
export function download(name:string,content:string,type='text/csv;charset=utf-8'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function safeCell(value:unknown){let s=String(value??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s=`'${s}`;return `"${s.replaceAll('"','""')}"`;}

export function storageLabel(value:string){return ({READY:'Pronto',ACTIVE:'Pronto',CONFIGURED:'Pronto',PENDING:'Preparando',FAILED:'Falha',ERROR:'Falha',DISABLED:'Desativado'} as Record<string,string>)[value]||'Não informado';}
