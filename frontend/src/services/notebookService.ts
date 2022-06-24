import axios from 'axios';
import {
  ImageStreamTag,
  Notebook,
  NotebookSize,
  Volume,
  VolumeMount,
} from '../types';
import { store } from '../redux/store/store';

export const getNotebook = (name: string): Promise<Notebook> => {
  const url = `/api/notebook/${name}`;
  return axios
    .get(url)
    .then((response) => {
      return response.data;
    })
    .catch((e) => {
      throw new Error(e.response.data.message);
    });
};

export const createNotebook = (
  name: string,
  tag: ImageStreamTag,
  notebookSize: NotebookSize | undefined,
  gpus: number,
  volumes?: Volume[],
  volumeMounts?: VolumeMount[]
): Promise<Notebook> => {
  const url = `/api/notebook`;
  // const resources = { ...notebookSize?.resources };
  const resources = {
    requests: {
      memory: '1Gi',
      cpu: '0.1'
    },
    limits: {
      memory: '2Gi',
      cpu: '0.2'
    }
  }
  //TODO: Add GPUs back in post summit
  // if (gpus > 0) {
  //   if (!resources.limits) {
  //     resources.limits = {};
  //   }
  //   resources.limits[LIMIT_NOTEBOOK_IMAGE_GPU] = gpus;
  // }

  //TODO: instead of store.getState().appState.user, we need to use session and proper auth permissions
  const data = {
    apiVersion: 'kubeflow.org/v1',
    kind: 'Notebook',
    metadata: {
      labels: {
        app: name,
        'opendatahub.io/odh-managed': 'true',
        'opendatahub.io/user': store.getState().appState.user,
      },
      name,
    },
    spec: {
      template: {
        spec: {
          containers: [
            {
              // TODO: authorize and pull from internal registry
              // image: `${imageStream?.status?.dockerImageRepository}:${tag.name}`,
              image: tag.from.name,
              imagePullPolicy: 'Always',
              name,
              env: [
                {
                  name: 'NOTEBOOK_ARGS',
                  value: "--NotebookApp.token='' --NotebookApp.password=''",
                },
              ],
              resources,
              volumeMounts,
              ports: [
                {
                  name: 'notebook-port',
                  containerPort: 8888,
                  protocol: 'TCP',
                },
              ],
              readinessProbe: {
                initialDelaySeconds: 5,
                periodSeconds: 5,
                timeoutSeconds: 1,
                successThreshold: 1,
                failureThreshold: 3,
                httpGet: {
                  path: '/api',
                  port: 'notebook-port',
                },
              },
            },
          ],
          volumes,
        },
      },
    },
  };

  return axios
    .post(url, data)
    .then((response) => {
      return response.data;
    })
    .catch((e) => {
      throw new Error(e.response.data.message);
    });
};

export const deleteNotebook = (name: string): Promise<any> => {
  const url = `/api/notebook/${name}`;

  return axios
    .delete(url)
    .then((response) => {
      return response.data;
    })
    .catch((e) => {
      throw new Error(e.response.data.message);
    });
};

export const patchNotebook = (
  name: string,
  updateData: any,
): Promise<Notebook> => {
  const url = `/api/notebook/${name}`;

  return axios
    .patch(url, updateData)
    .then((response) => {
      return response.data;
    })
    .catch((e) => {
      throw new Error(e.response.data.message);
    });
};