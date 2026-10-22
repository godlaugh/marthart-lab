import {sourceParameterWriteEvents} from './sourceParameterWriteEvents';
import type {SceneDocument} from '../types';
import {usesSourceDomain} from './sourceDomainTimeline';

/** Explicit value-editor events only. Other changes may be staged in the
 * author document, but are never inferred as runtime writes or applied here. */
export function sourceDomainParameterWrites(before:SceneDocument,next:SceneDocument,writes:unknown):readonly (readonly [string,number])[]|undefined {
 if(!usesSourceDomain(before)||!usesSourceDomain(next))return;
 return sourceParameterWriteEvents(before,next,writes);
}
