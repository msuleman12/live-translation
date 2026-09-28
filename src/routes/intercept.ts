import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { FastifyBaseLogger } from 'fastify';
import Twilio from 'twilio';

import AudioInterceptor from '@/services/AudioInterceptor';
import StreamSocket, { StartBaseAudioMessage } from '@/services/StreamSocket';

const interceptWS: FastifyPluginAsyncTypebox = async (server) => {
  server.get(
    '/intercept',
    {
      websocket: true,
    },
    async (socket, req) => {
      const twilio = Twilio(
        server.config.TWILIO_ACCOUNT_SID,
        server.config.TWILIO_AUTH_TOKEN,
      );
      const logger = req.diScope.resolve<FastifyBaseLogger>('logger');
      const ss = new StreamSocket({
        logger,
        socket,
      });
      const map =
        req.diScope.resolve<Map<string, AudioInterceptor>>('audioInterceptors');

      ss.onStart(async (message: StartBaseAudioMessage) => {
        const { customParameters } = message.start;

        if (
          customParameters?.direction === 'inbound' &&
          typeof customParameters.from === 'string'
        ) {
          ss.from = customParameters.from;
          const interceptor = new AudioInterceptor({
            logger,
            config: server.config,
            callerLanguage: customParameters.lang.toString(),
          });
          interceptor.callerSocket = ss;
          map.set(customParameters.from, interceptor);
          logger.info(
            'Added inbound interceptor for %s with streamSid %s for callSid',
            customParameters.from,
            message.start.streamSid,
          );

          logger.info('Connecting to Agent');
          // Answering machine detection: /agent-answered only connects the
          // stream when a person picks up, never a voicemail.
          const query = new URLSearchParams({
            callerCallSid: message.start.callSid,
            from: customParameters.from,
          });
          await twilio.calls.create({
            from: server.config.TWILIO_CALLER_NUMBER,
            to: server.config.TWILIO_AGENT_NUMBER,
            callerId: customParameters.from,
            machineDetection: 'Enable',
            url: `https://${server.config.NGROK_DOMAIN}/agent-answered?${query}`,
          });
        }

        if (
          customParameters?.direction === 'outbound' &&
          typeof customParameters.from === 'string'
        ) {
          const interceptor = map.get(customParameters.from);
          ss.from = customParameters.from;
          if (!interceptor) {
            logger.error(
              'No inbound interceptor found for %s',
              customParameters.from,
            );
            return;
          }
          logger.info(
            'Added outbound interceptor with streamSid %s',
            message.start.streamSid,
          );
          interceptor.agentSocket = ss;

          // Plain-phone mode: TWILIO_AGENT_NUMBER is an ordinary phone, so no TaskRouter
          // reservation will arrive to start translation - start it now.
          if (server.config.SKIP_FLEX === 'true') {
            logger.info('SKIP_FLEX is enabled - starting translation without Flex');
            interceptor.start();
          }
        }
      });

      ss.onStop((message) => {
        if (!message?.from) {
          logger.info('No from in message - unknown what interceptor to close');
          return;
        }

        const interceptor = map.get(message.from);
        if (!interceptor) {
          logger.error('No interceptor found for %s', message.from);
          return;
        }

        logger.info('Closing interceptor');
        interceptor.close();
        map.delete(message.from);
      });
    },
  );
};

export default interceptWS;
