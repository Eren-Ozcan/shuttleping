export const ingestLocationSchema = {
  body: {
    type: 'object',
    required: ['lat', 'lng'],
    additionalProperties: false,
    properties: {
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lng: { type: 'number', minimum: -180, maximum: 180 },
      heading: { type: 'number', minimum: 0, maximum: 360 },
      speed: { type: 'number', minimum: 0 },
    },
  },
}

export const getLocationSchema = {
  params: {
    type: 'object',
    required: ['routeId'],
    additionalProperties: false,
    properties: {
      routeId: { type: 'string', format: 'uuid' },
    },
  },
}

export const getEtaSchema = getLocationSchema

export const streamSchema = {
  params: getLocationSchema.params,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      // EventSource header taşıyamadığı için token query ile de gelebilir
      token: { type: 'string' },
    },
  },
}
