declare module 'minecraft-icon-items' {
  export interface MinecraftItem {
    id: string;
    name: string;
    meta: number;
    type: number;
    icon: string;
  }

  export interface MinecraftItemsApi {
    get(key: string | number): MinecraftItem | undefined;
    find?(key: string | number): MinecraftItem[];
    getBukkit?(key: string): MinecraftItem | undefined;
  }

  const minecraftItems: MinecraftItemsApi;
  export default minecraftItems;
}