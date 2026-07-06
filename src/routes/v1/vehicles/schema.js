const uuidParam = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
}

export const listVehiclesSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      active: { type: 'boolean' },
    },
  },
}

export const createVehicleSchema = {
  body: {
    type: 'object',
    required: ['plate'],
    additionalProperties: false,
    properties: {
      plate: { type: 'string', minLength: 2, maxLength: 20 },
      name: { type: 'string', maxLength: 100 },
    },
  },
}

export const updateVehicleSchema = {
  params: uuidParam,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      plate: { type: 'string', minLength: 2, maxLength: 20 },
      name: { type: 'string', maxLength: 100 },
      isActive: { type: 'boolean' },
    },
  },
}
