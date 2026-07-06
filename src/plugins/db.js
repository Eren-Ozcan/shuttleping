import fp from 'fastify-plugin'
import { pool } from '../db/pool.js'

async function dbPlugin(fastify) {
  fastify.decorate('db', pool)
  fastify.addHook('onClose', async () => pool.end())
}

export default fp(dbPlugin, { name: 'db' })
