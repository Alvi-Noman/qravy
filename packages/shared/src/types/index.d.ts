export * as v1 from './v1.js';
export * as v2 from './v2.js';
/** Back-compat named exports => v1 by default */
export type { UserDTO, MenuItemDTO, CategoryDTO, VariationDTO, VariantOptionDTO } from './v1.js';
