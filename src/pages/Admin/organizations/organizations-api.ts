import { buildApiError, fetchWithNetworkGuard, parseResponseJson } from '../../../lib/api-transport.ts';
import { ApiError as ManagementApiError } from '../../../lib/error-contract.ts';
import { normalizeUserError } from '../../../lib/user-error-catalog.ts';
export { ManagementApiError };
const BASE='/api/admin/organization-management';
export async function api<T>(path:string,options:{signal?:AbortSignal;body?:unknown;key?:string}={}):Promise<T>{
  const response=await fetchWithNetworkGuard(`${BASE}${path}`,{method:options.body===undefined?'GET':'POST',credentials:'include',signal:options.signal,
    headers:{Accept:'application/json',...(options.body===undefined?{}:{'Content-Type':'application/json','X-Maono-Management':'1'}),...(options.key?{'Idempotency-Key':options.key}:{})},
    body:options.body===undefined?undefined:JSON.stringify(options.body)});
  const parsed=await parseResponseJson(response);
  if(!response.ok) throw buildApiError(response,parsed.valid?parsed.data:null);
  const data=parsed.valid?parsed.data as {ok?:boolean}|null:null;
  if(data?.ok!==true) throw buildApiError(response,null,{status:502,code:'MANAGEMENT_RESPONSE_INVALID',retryable:true});
  return data as T;
}
export function errorText(error:unknown){return normalizeUserError(error).message;}
export function denied(error:unknown){return error instanceof ManagementApiError&&[401,403,404].includes(error.status);}
export function dateLabel(value:string|null){if(!value)return 'Sem registro';const date=new Date(value.includes('T')?value:`${value.replace(' ','T')}Z`);return Number.isNaN(date.getTime())?'Sem registro':new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(date);}
export function download(name:string,content:string,type='text/csv;charset=utf-8'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function safeCell(value:unknown){let s=String(value??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s=`'${s}`;return `"${s.replaceAll('"','""')}"`;}

export function storageLabel(value:string){return ({READY:'Pronto',ACTIVE:'Pronto',CONFIGURED:'Pronto',PENDING:'Preparando',FAILED:'Falha',ERROR:'Falha',DISABLED:'Desativado'} as Record<string,string>)[value]||'Não informado';}
