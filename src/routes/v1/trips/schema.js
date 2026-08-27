const tripStopShape = {
  type: 'object',
  properties: {
    stopId: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    sequence: { type: 'integer' },
    state: { type: 'string', enum: ['pending', 'notified', 'passed'] },
    notifiedAt: { type: ['string', 'null'], format: 'date-time' },
    passedAt: { type: ['string', 'null'], format: 'date-time' },
  },
}

const tripShape = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    routeId: { type: 'string', format: 'uuid' },
    routeName: { type: 'string' },
    driverId: { type: 'string', format: 'uuid' },
    vehicleId: { type: ['string', 'null'], format: 'uuid' },
    status: { type: 'string', enum: ['active', 'completed', 'abandoned'] },
    startedAt: { type: 'string', format: 'date-time' },
    endedAt: { type: ['string', 'null'], format: 'date-time' },
    lastPingAt: { type: 'string', format: 'date-time' },
  },
}

export const startTripSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  response: {
    200: tripShape,
    201: tripShape,
  },
}

export const endTripSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
}

export const listTripsSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      routeId: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: ['active', 'completed', 'abandoned'] },
      from: { type: 'string', format: 'date-time' },
      to: { type: 'string', format: 'date-time' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
    },
  },
}

export const getTripSchema = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        ...tripShape.properties,
        stops: { type: 'array', items: tripStopShape },
        notifications: {
          type: 'object',
          properties: {
            sent: { type: 'integer' },
            failed: { type: 'integer' },
          },
        },
      },
    },
  },
}
