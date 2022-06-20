// import { KubeFastifyInstance } from '../../../types';
// import { FastifyReply, FastifyRequest } from 'fastify';
// import { listImageStreams } from './imageUtils';

// module.exports = async (fastify: KubeFastifyInstance) => {
//   fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
//     return listImageStreams()
//       .then((res) => {
//         return res;
//       })
//       .catch((res) => {
//         reply.send(res);
//       });
//   });
// };

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  addNotebook,
  deleteNotebook,
  getNotebook,
  getNotebooks,
  updateNotebook,
} from './notebooksImageStreamUtils';

export default async (fastify: FastifyInstance): Promise<void> => {
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return getImageList(fastify)
      .then((res) => {
        return res;
      })
      .catch((res) => {
        reply.send(res);
      });
  });

  fastify.get('/:image', async (request: FastifyRequest, reply: FastifyReply) => {
    return getImage(fastify, request)
      .then((res) => {
        return res;
      })
      .catch((res) => {
        reply.send(res);
      });
  });

  fastify.delete('/:image', async (request: FastifyRequest, reply: FastifyReply) => {
    return deleteImage(fastify, request)
      .then((res) => {
        return res;
      })
      .catch((res) => {
        reply.send(res);
      });
  });

  fastify.put('/:image', async (request: FastifyRequest, reply: FastifyReply) => {
    return updateImage(fastify, request)
      .then((res) => {
        return res;
      })
      .catch((res) => {
        reply.send(res);
      });
  });

  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return postImage(fastify, request)
      .then((res) => {
        return res;
      })
      .catch((res) => {
        reply.send(res);
      });
  });
};
