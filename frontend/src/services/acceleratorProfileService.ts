import axios from 'axios';
import { AcceleratorKind } from '~/k8sTypes';
import { ResponseStatus } from '~/types';

export const createAcceleratorProfile = (
  acceleratorProfile: AcceleratorKind['spec'],
): Promise<ResponseStatus> => {
  const url = '/api/accelerator-profiles';
  return axios
    .post(url, acceleratorProfile)
    .then((response) => response.data)
    .catch((e) => {
      throw new Error(e.response.data.message);
    });
};

export const deleteAcceleratorProfile = (name: string): Promise<ResponseStatus> => {
  const url = `/api/accelerator-profiles/${name}`;
  return axios
    .delete(url)
    .then((response) => response.data)
    .catch((e) => {
      throw new Error(e.response.data.message);
    });
};

export const updateAcceleratorProfile = (
  name: string,
  spec: Partial<AcceleratorKind['spec']>,
): Promise<ResponseStatus> => {
  const url = `/api/accelerator-profiles/${name}`;
  return axios
    .put(url, spec)
    .then((response) => response.data)
    .catch((e) => {
      throw new Error(e.response.data.message);
    });
};
