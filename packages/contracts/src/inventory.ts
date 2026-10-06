import { z } from 'zod';
import { isValidBookingPrefix, isValidTimeZone } from '@staydesk/domain';
import { emailSchema } from './auth.js';
import { localDateSchema } from './common.js';

const supportedCurrencies = new Set(
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : [],
);

export const PROPERTY_TYPES = ['HOTEL', 'RESORT', 'VILLA', 'HOMESTAY', 'HOSTEL', 'OTHER'] as const;
export const AGENT_VISIBILITIES = [
  'STATUS_ONLY',
  'CAPPED_COUNT',
  'EXACT_COUNT',
  'FULL_BREAKDOWN',
] as const;

const timeZone = z.string().refine(isValidTimeZone, 'Choose a valid time zone');
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .refine(
    (c) => /^[A-Z]{3}$/.test(c) && (supportedCurrencies.size === 0 || supportedCurrencies.has(c)),
    'Use a valid ISO currency code',
  );
const country = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Use a 2-letter country code');
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,8}$/, 'Use 2–8 letters or digits');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 14:00');
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const propertySettings = {
  name: z.string().trim().min(1).max(160),
  type: z.enum(PROPERTY_TYPES),
  timezone: timeZone,
  currency,
  country,
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(120),
  region: optionalText(120),
  postalCode: optionalText(20),
  phone: optionalText(40),
  email: emailSchema.nullable().optional(),
  checkInTime: hhmm,
  checkOutTime: hhmm,
  childMaxAge: z.number().int().min(0).max(17),
  tentativeHoldHours: z.number().int().min(1).max(336),
  lowAvailabilityThreshold: z.number().int().min(0).max(1000),
  bookingHorizonDays: z.number().int().min(1).max(1095),
  maxStayNights: z.number().int().min(1).max(365),
  bookingRefPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isValidBookingPrefix, 'Use 2–8 letters or digits'),
  agentDefaultVisibility: z.enum(AGENT_VISIBILITIES),
  agentCountCap: z.number().int().min(1).max(1000),
  agentRequestExpiryHours: z.number().int().min(1).max(720),
  isDiscoverable: z.boolean(),
};

export const createPropertySchema = z.strictObject({
  ...propertySettings,
  code,
  type: propertySettings.type.default('HOTEL'),
  currency: propertySettings.currency.default('INR'),
  checkInTime: hhmm.default('14:00'),
  checkOutTime: hhmm.default('11:00'),
  childMaxAge: propertySettings.childMaxAge.default(12),
  tentativeHoldHours: propertySettings.tentativeHoldHours.default(48),
  lowAvailabilityThreshold: propertySettings.lowAvailabilityThreshold.default(2),
  bookingHorizonDays: propertySettings.bookingHorizonDays.default(730),
  maxStayNights: propertySettings.maxStayNights.default(90),
  bookingRefPrefix: propertySettings.bookingRefPrefix.optional(),
  agentDefaultVisibility: propertySettings.agentDefaultVisibility.default('FULL_BREAKDOWN'),
  agentCountCap: propertySettings.agentCountCap.default(5),
  agentRequestExpiryHours: propertySettings.agentRequestExpiryHours.default(24),
  isDiscoverable: propertySettings.isDiscoverable.default(false),
});

export const updatePropertySchema = z
  .strictObject({
    ...Object.fromEntries(Object.entries(propertySettings).map(([k, v]) => [k, v.optional()])),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  } as { [K in keyof typeof propertySettings]: z.ZodOptional<(typeof propertySettings)[K]> } & {
    status: z.ZodOptional<z.ZodEnum<{ ACTIVE: 'ACTIVE'; INACTIVE: 'INACTIVE' }>>;
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const createHolidaySchema = z.strictObject({
  date: localDateSchema,
  name: z.string().trim().min(1).max(120),
});

const occupancy = {
  maxAdults: z.number().int().min(1).max(50),
  maxChildren: z.number().int().min(0).max(50),
  maxOccupancy: z.number().int().min(1).max(100),
};

const roomTypeFields = {
  name: z.string().trim().min(1).max(120),
  description: optionalText(2000),
  ...occupancy,
  /** Ignored for room types that track individual rooms (total = active rooms). */
  totalInventory: z.number().int().min(0).max(100_000),
  baseRateMinor: z.number().int().min(0).max(1_000_000_000_000).nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  sortOrder: z.number().int().min(0).max(10_000),
  internalNotes: optionalText(4000),
};

const occupancyConsistent = (v: {
  maxAdults?: number;
  maxChildren?: number;
  maxOccupancy?: number;
}) =>
  v.maxAdults === undefined ||
  v.maxChildren === undefined ||
  v.maxOccupancy === undefined ||
  v.maxOccupancy <= v.maxAdults + v.maxChildren;
const occupancyMessage = {
  message: 'Maximum guests cannot exceed maximum adults plus children',
  path: ['maxOccupancy'],
};

export const createRoomTypeSchema = z
  .strictObject({
    ...roomTypeFields,
    code,
    trackRooms: z.boolean().default(false),
    totalInventory: roomTypeFields.totalInventory.default(0),
    baseRateMinor: roomTypeFields.baseRateMinor.default(null),
    status: roomTypeFields.status.default('ACTIVE'),
    sortOrder: roomTypeFields.sortOrder.default(0),
  })
  .refine(occupancyConsistent, occupancyMessage);

export const updateRoomTypeSchema = z
  .strictObject({
    name: roomTypeFields.name.optional(),
    code: code.optional(),
    description: roomTypeFields.description,
    maxAdults: occupancy.maxAdults.optional(),
    maxChildren: occupancy.maxChildren.optional(),
    maxOccupancy: occupancy.maxOccupancy.optional(),
    trackRooms: z.boolean().optional(),
    totalInventory: roomTypeFields.totalInventory.optional(),
    baseRateMinor: roomTypeFields.baseRateMinor.optional(),
    status: roomTypeFields.status.optional(),
    sortOrder: roomTypeFields.sortOrder.optional(),
    internalNotes: roomTypeFields.internalNotes,
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

const roomNumber = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/,
    'Use letters, digits, spaces, dots, dashes or underscores',
  );

export const createRoomsSchema = z.strictObject({
  roomTypeId: z.uuid(),
  rooms: z
    .array(
      z.strictObject({
        number: roomNumber,
        floor: optionalText(20),
        building: optionalText(60),
      }),
    )
    .min(1)
    .max(500)
    .refine(
      (rooms) => new Set(rooms.map((r) => r.number.toLowerCase())).size === rooms.length,
      'Room numbers must be unique',
    ),
});

export const updateRoomSchema = z
  .strictObject({
    number: roomNumber.optional(),
    floor: optionalText(20),
    building: optionalText(60),
    notes: optionalText(2000),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    roomTypeId: z.uuid().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export type CreatePropertyRequest = z.infer<typeof createPropertySchema>;
export type UpdatePropertyRequest = z.infer<typeof updatePropertySchema>;
export type CreateRoomTypeRequest = z.infer<typeof createRoomTypeSchema>;
export type UpdateRoomTypeRequest = z.infer<typeof updateRoomTypeSchema>;
export type CreateRoomsRequest = z.infer<typeof createRoomsSchema>;
export type UpdateRoomRequest = z.infer<typeof updateRoomSchema>;

export interface PropertyView {
  id: string;
  name: string;
  code: string;
  type: (typeof PROPERTY_TYPES)[number];
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  timezone: string;
  currency: string;
  country: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  checkInTime: string;
  checkOutTime: string;
  childMaxAge: number;
  tentativeHoldHours: number;
  lowAvailabilityThreshold: number;
  bookingHorizonDays: number;
  maxStayNights: number;
  bookingRefPrefix: string;
  agentDefaultVisibility: (typeof AGENT_VISIBILITIES)[number];
  agentCountCap: number;
  agentRequestExpiryHours: number;
  isDiscoverable: boolean;
  /** Today in the property's time zone (BR-03). */
  businessDate: string;
  createdAt: string;
}

export interface HolidayView {
  id: string;
  date: string;
  name: string;
  propertyId: string | null;
}

export interface RoomTypeView {
  id: string;
  propertyId: string;
  name: string;
  code: string;
  description: string | null;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  trackRooms: boolean;
  totalInventory: number;
  /** Omitted unless the viewer may see financials. */
  baseRateMinor?: number | null;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  sortOrder: number;
  /** Omitted unless the viewer may see internal notes. */
  internalNotes?: string | null;
  version: number;
  roomCount: number;
}

export interface RoomView {
  id: string;
  propertyId: string;
  roomTypeId: string;
  number: string;
  floor: string | null;
  building: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  housekeeping: 'CLEAN' | 'DIRTY' | 'INSPECTED';
  notes: string | null;
}
