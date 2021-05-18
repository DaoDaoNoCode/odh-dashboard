import * as React from 'react';
import {
  Button,
  Modal,
  ModalVariant,
  TextInput,
} from '@patternfly/react-core';

type SegmentKeyModalProps = {
  onClose: () => void;
  segmentKey: string;
  setSegmentKey: (segmentKey: string) => void;
  segmentKeyEnabled: boolean;
  setSegmentKeyEnabled: (enabled: boolean) => void;
};

const SegmentKeyModal: React.FC<SegmentKeyModalProps> = ({ onClose, segmentKey, setSegmentKey, segmentKeyEnabled, setSegmentKeyEnabled }) => {
  const [text, setText] = React.useState<string>('');

  return (
    <Modal
      variant={ModalVariant.small}
      title='Set Your Segment Key'
      isOpen
      onClose={onClose}
      actions={[
        <Button key="confirm" variant="primary" onClick={() => {
          setSegmentKey(text);
          setSegmentKeyEnabled(true);
          onClose();
        }}>
          Enable
        </Button>,
        <Button key="cancel" variant="link" onClick={onClose}>
          Cancel
        </Button>,
      ]}
    >
      <TextInput id="segment-key" value={text} type="text" onChange={setText} />
    </Modal>
  );
};

export default SegmentKeyModal;
