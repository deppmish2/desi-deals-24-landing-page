import { createContext } from "react";
export const CartContext = createContext({
  items: [],
  addItem: () => {},
  removeItem: () => {},
  updateItem: () => {},
  clearCart: () => {},
  setBrand: () => {},
  count: 0,
});
