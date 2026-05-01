import { createContext } from "react";
export const CartContext = createContext({ items: [], addItem: () => {}, removeItem: () => {}, updateItem: () => {}, clearCart: () => {}, count: 0 });
