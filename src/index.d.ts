import type * as Contract from './contracts.js';
export type * from './contracts.js';
export { SDK_VERSION, PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from './version.js';
export type PermissionRequiredError = Contract.PermissionRequiredError;
export type ConnectionError = Contract.ConnectionError;
export type ProtocolError = Contract.ProtocolError;
export type HostActionError = Contract.HostActionError;
export type W3BoosterClient<TSettings extends object = Contract.JsonObject, TOverlayExtensions extends object = object> = Contract.W3BoosterClient<TSettings, TOverlayExtensions>;
/** Runtime error constructors exposed for `instanceof` and explicit error creation. */
export declare const PermissionRequiredError: typeof Contract.PermissionRequiredError;
export declare const ConnectionError: typeof Contract.ConnectionError;
export declare const ProtocolError: typeof Contract.ProtocolError;
export declare const HostActionError: typeof Contract.HostActionError;
/** Runtime class identity for `instanceof`; clients are created through the factory functions. */
export declare const W3BoosterClient: typeof Contract.W3BoosterClient;
/** Open a W3Booster transport without waiting for hydrated state. */
export declare const openClient: typeof Contract.openClient;
/** Create a client and wait for the frontend lifecycle milestone requested by startup options. */
export declare const startClient: typeof Contract.startClient;
/** Create a client synchronously so lifecycle listeners can be attached before connecting. */
export declare const createClient: typeof Contract.createClient;
export declare const isAbortError: typeof Contract.isAbortError;
export declare const isW3BoosterError: typeof Contract.isW3BoosterError;
export declare const classifyW3BoosterError: typeof Contract.classifyW3BoosterError;
export declare const canUseHostCapability: typeof Contract.canUseHostCapability;
export declare const UNAVAILABLE_HOST_SNAPSHOT: typeof Contract.UNAVAILABLE_HOST_SNAPSHOT;
