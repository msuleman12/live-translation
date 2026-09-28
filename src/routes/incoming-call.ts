import {
  FastifyPluginAsyncTypebox,
  Type,
} from '@fastify/type-provider-typebox';
import { FastifyBaseLogger } from 'fastify';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';

const incomingCall: FastifyPluginAsyncTypebox = async (server) => {
  server.post(
    '/incoming-call',
    {
      logLevel: 'info',
      schema: {
        body: Type.Object({
          From: Type.String(),
          To: Type.String(),
          CallSid: Type.String(),
        }),
        // Set by the Studio Flow redirect: /incoming-call?lang=<language>
        querystring: Type.Object({
          lang: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const logger = req.diScope.resolve<FastifyBaseLogger>('logger');
      const response = new VoiceResponse();

      try {
        logger.info('Setting up media stream...');
        response.say('Please wait while we connect your call.');
        const connect = response.connect();
        const stream = connect.stream({
          name: 'Example Audio Stream',
          url: `wss://${server.config.NGROK_DOMAIN}/intercept`,
        });
        stream.parameter({
          name: 'direction',
          value: 'inbound',
        });
        stream.parameter({
          name: 'from',
          value: req.body.From,
        });
        stream.parameter({
          name: 'lang',
          value: req.query.lang,
        });

        logger.info('Sending TwiML response...');
        reply.type('text/xml');
        reply.send(response.toString());
      } catch (error) {
        logger.error('Error creating Flex task:', { error });
        reply.status(500).send('Internal Server Error');
      }
    },
  );
};

export default incomingCall;
