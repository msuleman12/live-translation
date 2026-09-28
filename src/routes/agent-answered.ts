import {
  FastifyPluginAsyncTypebox,
  Type,
} from '@fastify/type-provider-typebox';
import { FastifyBaseLogger } from 'fastify';
import Twilio from 'twilio';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';

/**
 * Called by Twilio when the agent leg is answered. The call is created with
 * answering machine detection, so AnsweredBy says whether a person or a
 * voicemail picked up. Only a person gets connected to the translation stream.
 */
const agentAnswered: FastifyPluginAsyncTypebox = async (server) => {
  server.post(
    '/agent-answered',
    {
      logLevel: 'info',
      schema: {
        body: Type.Object({
          AnsweredBy: Type.Optional(Type.String()),
        }),
        querystring: Type.Object({
          callerCallSid: Type.String(),
          from: Type.String(),
        }),
      },
    },
    async (req, reply) => {
      const logger = req.diScope.resolve<FastifyBaseLogger>('logger');
      const { callerCallSid, from } = req.query;
      const answeredBy = req.body.AnsweredBy ?? 'unknown';
      const response = new VoiceResponse();

      if (answeredBy.startsWith('machine') || answeredBy === 'fax') {
        logger.info('Agent leg answered by %s - not connecting', answeredBy);
        response.hangup();

        // Tell the caller and end their call, which also closes the interceptor
        const twilio = Twilio(
          server.config.TWILIO_ACCOUNT_SID,
          server.config.TWILIO_AUTH_TOKEN,
        );
        const callerResponse = new VoiceResponse();
        callerResponse.say(
          'Sorry, no agent is available right now. Please try again later.',
        );
        callerResponse.hangup();
        try {
          await twilio
            .calls(callerCallSid)
            .update({ twiml: callerResponse.toString() });
        } catch (error) {
          logger.error({ error }, 'Failed to end caller leg');
        }
      } else {
        logger.info('Agent leg answered by %s - connecting', answeredBy);
        response.say('A customer is on the line.');
        const stream = response.connect().stream({
          name: 'Outbound Audio Stream',
          url: `wss://${server.config.NGROK_DOMAIN}/intercept`,
        });
        stream.parameter({ name: 'direction', value: 'outbound' });
        stream.parameter({ name: 'callSid', value: callerCallSid });
        stream.parameter({ name: 'from', value: from });
      }

      reply.type('text/xml');
      reply.send(response.toString());
    },
  );
};

export default agentAnswered;
