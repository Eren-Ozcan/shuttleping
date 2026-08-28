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
      // Real capture time (ISO) on an offline-buffer flush; otherwise now()
      recordedAt: { type: 'string', format: 'date-time' },
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

export const streamTicketSchema = getLocationSchema

export const streamSchema = {
  params: getLocationSchema.params,
  querystring: {
    type: 'object',
    required: ['ticket'],
    additionalProperties: false,
    properties: {
      // EventSource cannot carry a header. Instead of the access token, a
      // single-use short-lived ticket is sent — the access token never enters
      // the URL, proxy logs or the Referer (D2).
      ticket: { type: 'string', minLength: 16, maxLength: 128 },
    },
  },
}
