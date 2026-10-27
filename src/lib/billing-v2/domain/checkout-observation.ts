import {digest} from "./subscription-policy";
export interface Attempt {key:string;parameters:unknown;parametersDigest:string;createdAt:string;replayDeadline:string;sessionId:string|null}
/** Observes an existing frozen intent only. No provider dispatch or new key API. */
export function observeAttempt(attempt:Attempt,now:string){if(!attempt.key||digest(attempt.parameters)!==attempt.parametersDigest||Date.parse(now)>=Date.parse(attempt.replayDeadline))return {kind:"needs_attention" as const};return {kind:"resume_existing" as const,key:attempt.key,parameters:attempt.parameters,sessionId:attempt.sessionId};}
