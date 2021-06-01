import { KubeFastifyInstance, ODHSegmentKey } from '../../../types';

export const getSegmentKey = async (
  fastify: KubeFastifyInstance
): Promise<ODHSegmentKey> => {
  const coreV1Api = fastify.kube.coreV1Api;
  const namespace = fastify.kube.namespace;
  const customObjectsApi = fastify.kube.customObjectsApi;
  try {
    const res = await coreV1Api.readNamespacedSecret('rhods-segment-key', namespace);
    const decodedSegmentKey = Buffer.from(res.body.data.segmentKey, 'base64').toString();
    console.log('segment key: ' + decodedSegmentKey);
    const clusterVersionList = await customObjectsApi.listClusterCustomObject('config.openshift.io', 'v1', 'clusterversions');
    console.log('cluster id: ' + (clusterVersionList.body as any).items[0]?.spec.clusterID);
    return {
      segmentKey: decodedSegmentKey
    };
  } catch (e) {
    fastify.log.error('load segment key error: ' + e);
    return {
      segmentKey: ''
    }
  }
};
