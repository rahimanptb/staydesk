/**
 * Product identity. Renaming the product is a change to this file only; domains and
 * addresses come from the environment so each deployment can use its own.
 */
export const brand = {
  productName: 'StayDesk',
  tagline: 'Room inventory, bookings and B2B availability for hotels and resorts',
  portals: {
    hotel: 'Hotel',
    agent: 'Agents',
    admin: 'Admin',
  },
} as const;

export type Brand = typeof brand;
