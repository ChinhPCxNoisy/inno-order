/**
 * Module tra phi, bat/tat theo tung quan boi Super Admin (Store.enabledModules).
 * Them module moi: khai bao them 1 key o day, cac cho khac tu dong nhan dien qua ModuleKey.
 */
export const MODULE_DEFS = {
  staff_rating: {
    label: 'Đánh giá nhân viên sau thanh toán',
    description: 'Khách quét QR đánh giá nhân viên phục vụ sau khi thanh toán xong.',
  },
} as const;

export type ModuleKey = keyof typeof MODULE_DEFS;

export const MODULE_KEYS = Object.keys(MODULE_DEFS) as ModuleKey[];

export function isValidModuleKey(key: string): key is ModuleKey {
  return (MODULE_KEYS as string[]).includes(key);
}

export function isModuleEnabled(store: { enabledModules: string[] }, key: ModuleKey): boolean {
  return store.enabledModules.includes(key);
}
