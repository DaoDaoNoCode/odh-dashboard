import * as React from 'react';
import { Button, Modal } from '@patternfly/react-core';

type DisableAcceleratorProfileModal = {
  isOpen: boolean;
  onClose: (confirmStatus: boolean) => void;
};

const DisableAcceleratorProfileModal: React.FC<DisableAcceleratorProfileModal> = ({
  isOpen,
  onClose,
}) => (
  <Modal
    variant="small"
    title="Disable accelerator profile"
    isOpen={isOpen}
    onClose={() => onClose(false)}
    actions={[
      <Button key="confirm-disable" variant="primary" onClick={() => onClose(true)}>
        Disable
      </Button>,
      <Button key="cancel" variant="secondary" onClick={() => onClose(false)}>
        Cancel
      </Button>,
    ]}
  >
    This will disable the accelerator profile and it will no longer be available for use with new
    workbenches and runtimes. Existing resources using this profile will retain it unless a new
    profile is selected.
  </Modal>
);

export default DisableAcceleratorProfileModal;
