import type { DeepReadonly, JsonValue, Scope, SettingsPath as CoreSettingsPath, SettingsPathValue } from './index.js';

export type SettingsPath<TSettings> = CoreSettingsPath<TSettings>;
export interface AppSettingOption<TValue extends JsonValue = JsonValue> { readonly value: TValue; readonly label: string }
export type AppSettingCondition<TSettings extends object> = { [TPath in SettingsPath<TSettings>]: { readonly key: TPath; readonly equals: SettingsPathValue<TSettings, TPath> } }[SettingsPath<TSettings>];
interface FieldBase<TSettings extends object, TPath extends SettingsPath<TSettings>> {
  readonly key: TPath;
  readonly label: string;
  readonly type: SettingsPathValue<TSettings, TPath> extends boolean ? 'boolean' | 'select' : SettingsPathValue<TSettings, TPath> extends number ? 'number' | 'select' : 'text' | 'country' | 'select';
  readonly default?: SettingsPathValue<TSettings, TPath>;
  readonly description?: string;
  readonly options?: readonly AppSettingOption<Extract<SettingsPathValue<TSettings, TPath>, JsonValue>>[];
  readonly requiresPlan?: 'pro';
  readonly internal?: boolean;
  readonly group?: string;
  readonly visibleWhen?: AppSettingCondition<TSettings>;
  readonly enabledWhen?: AppSettingCondition<TSettings>;
}
export type AppSettingField<TSettings extends object = Record<string, JsonValue>> = { [TPath in SettingsPath<TSettings>]: FieldBase<TSettings, TPath> }[SettingsPath<TSettings>];
export interface AppSettingsGroup { readonly id: string; readonly title: string; readonly description?: string }
export interface AppSettingsSection<TSettings extends object = Record<string, JsonValue>> { readonly id: string; readonly title: string; readonly description?: string; readonly groups?: readonly AppSettingsGroup[]; readonly fields: readonly AppSettingField<TSettings>[] }
export interface AppSettingsSchema<TSettings extends object = Record<string, JsonValue>> { readonly version: 1; readonly sections: readonly AppSettingsSection<TSettings>[] }
export interface ApplicationSettingsDefinition<TSettings extends object = Record<string, JsonValue>> { readonly clientId: string; readonly revision: string; readonly scopes: readonly Scope[]; readonly settingsSchema?: AppSettingsSchema<TSettings> }
export type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { readonly [TKey in keyof T]?: DeepPartial<T[TKey]> } : T;

export function validateSettingsSchema<TSettings extends object>(schema: AppSettingsSchema<TSettings>): DeepReadonly<AppSettingsSchema<TSettings>>;
export function validateSettingsSchema<TSettings extends object = Record<string, JsonValue>>(schema: unknown): DeepReadonly<AppSettingsSchema<TSettings>>;
export function settingsDefaults<TSettings extends object>(schema: AppSettingsSchema<TSettings>): DeepReadonly<DeepPartial<TSettings>>;
/** Recursively apply delivered partial settings over defaults. Arrays replace rather than merge. */
export function resolveSettings<TSettings extends object>(
  defaults: TSettings,
  settings?: DeepPartial<TSettings>
): DeepReadonly<TSettings>;
export function resolveSettings<TSettings extends object>(
  defaults: DeepPartial<TSettings>,
  settings?: DeepPartial<TSettings>
): DeepReadonly<DeepPartial<TSettings>>;
export function generateSettingsBinding(definition: ApplicationSettingsDefinition): string;
