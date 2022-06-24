import * as React from 'react';
import { Button, ExpandableSection, List, ListItem, Modal, ModalVariant } from '@patternfly/react-core';

import './NotebookController.scss';

type StartServerModalProps = {
  startShown: boolean;
  onClose: () => void;
};

type SpawnStatus = {
  status: 'success' | 'danger' | 'warning' | 'info' | 'default';
  title: string;
  reason: React.ReactNode;
};

const StartServerModal: React.FC<StartServerModalProps> = ({
  startShown,
  onClose
}) => {
  const [spawnStatus, setSpawnStatus] = React.useState<SpawnStatus | null>(null);
  const [isMessageExpanded, setMessageExpanded] = React.useState<boolean>(false);

  const renderMessages = (
    <ExpandableSection
      toggleText={`${isMessageExpanded ? 'Collapse' : 'Expand'} event log`}
      onToggle={isExpanded => setMessageExpanded(isExpanded)}
      isExpanded={isMessageExpanded}
      isIndented
    >
      <List isPlain isBordered>
        <ListItem>First</ListItem>
        <ListItem>Second</ListItem>
        <ListItem>Third</ListItem>
      </List>
    </ExpandableSection>
  );

  return <Modal
      aria-label="Starting server modal"
      className="odh-notebook-controller__start-server-modal"
      description="Depending on the size and resources requested, this can take several minutes. To track progress, expand the event log."
      appendTo={document.body}
      variant={ModalVariant.small}
      title="Starting server"
      isOpen={startShown}
      showClose={spawnStatus?.status === 'danger' || spawnStatus?.status === 'warning'}
      onClose={onClose}
      footer={renderMessages}
  >
    <Button key="cancel" variant="secondary" onClick={onClose}>
      Cancel
    </Button>
  </Modal>
};

StartServerModal.displayName = "StartServerModal";

export default StartServerModal;