// super_admin destek erişimi için (E12): hangi kiracının verisi okunacak.
// Şemalarda tanımlı olmalı, aksi halde removeAdditional bunu düşürür.
const supportCompanyId = { companyId: { type: 'string', format: 'uuid' } }

const uuidParam = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
}

const stopParams = {
  type: 'object',
  required: ['id', 'stopId'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    stopId: { type: 'string', format: 'uuid' },
  },
}

export const listRoutesSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      active: { type: 'boolean' },
      ...supportCompanyId,
    },
  },
}

export const createRouteSchema = {
  body: {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 100 },
    },
  },
}

export const updateRouteSchema = {
  params: uuidParam,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 100 },
      // null göndermek atamayı kaldırır
      driverId: { type: ['string', 'null'], format: 'uuid' },
      vehicleId: { type: ['string', 'null'], format: 'uuid' },
      isActive: { type: 'boolean' },
    },
  },
}

export const listStopsSchema = {
  params: uuidParam,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { ...supportCompanyId },
  },
}

export const createStopSchema = {
  params: uuidParam,
  body: {
    type: 'object',
    required: ['name', 'lat', 'lng', 'sequence'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 100 },
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lng: { type: 'number', minimum: -180, maximum: 180 },
      sequence: { type: 'integer', minimum: 1 },
    },
  },
}

export const updateStopSchema = {
  params: stopParams,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 100 },
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lng: { type: 'number', minimum: -180, maximum: 180 },
      sequence: { type: 'integer', minimum: 1 },
      isActive: { type: 'boolean' },
    },
  },
}
