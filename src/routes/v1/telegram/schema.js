// Telegram's Update object has dozens of optional fields; only the ones the
// webhook reads are declared — ajv's removeAdditional strips the rest.
export const webhookSchema = {
  body: {
    type: 'object',
    properties: {
      message: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          chat: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
            },
          },
        },
      },
    },
  },
}
