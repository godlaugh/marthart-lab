export class SourceNativeError extends Error {
 constructor(readonly kind:string,message:string){super(message);this.name='SourceNativeError';}
}
