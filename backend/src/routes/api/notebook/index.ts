import { KubeFastifyInstance, Notebook } from '../../../types';
import { FastifyReply, FastifyRequest } from 'fastify';
import { getNotebook, patchNotebook, postNotebook } from './notebookUtils';

module.exports = async (fastify: KubeFastifyInstance) => {
  fastify.get('/:notebookName', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as {
      notebookName: string;
    };
    return getNotebook(fastify, params.notebookName)
      .then((res) => {
        return res;
      })
      .catch((res) => {
        reply.send(res);
      });;
  });

  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const notebookData = request.body as Notebook;

    return postNotebook(fastify, notebookData)
      .then((res) => {
        return res;
      })
      .catch((res) => { 
        reply.send(res);
      });
  });

  fastify.delete('/:notebookName', async (request: FastifyRequest, reply: FastifyReply) => {
      const namespace = fastify.kube.namespace;
      const params = request.params as {
        notebookName: string;
      };
      return fastify.kube.customObjectsApi.deleteNamespacedCustomObject(
        'kubeflow.org',
        'v1',
        namespace,
        'notebooks',
        params.notebookName,
      ).then((res) => {
        return res;
      })
      .catch((res) => {
        reply.send(res);
      });
    },
  );

  fastify.patch('/:notebookName',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const requestBody = request.body as { stopped: boolean } | any;
      const params = request.params as {
        notebookName: string;
      };

      return patchNotebook(fastify, requestBody, params.notebookName)
      .then((res) => {
        return res;
      })
      .catch((res) => {
        reply.send(res);
      });;
    },
  );
};
