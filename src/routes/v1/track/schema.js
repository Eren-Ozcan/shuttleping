export const getTrackSchema = {
  params: {
    type: 'object',
    required: ['token'],
    additionalProperties: false,
    properties: {
      // hex(24) from randomBytes — see notification.worker.js
      token: { type: 'string', minLength: 32, maxLength: 128, pattern: '^[a-f0-9]+$' },
    },
  },
}
