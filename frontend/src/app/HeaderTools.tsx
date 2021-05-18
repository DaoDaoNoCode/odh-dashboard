import React from 'react';
import {
  Dropdown,
  DropdownPosition,
  DropdownToggle,
  PageHeaderTools,
  PageHeaderToolsGroup,
  PageHeaderToolsItem,
  DropdownItem,
} from '@patternfly/react-core';
import {
  CaretDownIcon,
  CogIcon,
  ExternalLinkAltIcon,
  QuestionCircleIcon,
  UserIcon,
} from '@patternfly/react-icons';
import { DOC_LINK, SUPPORT_LINK } from '../utilities/const';
import SegmentKeyModal from './SegmentKeyModal'
import { useSelector } from 'react-redux';
import { initSegment } from 'utilities/segmentIOTrackingUtils';

const HeaderTools: React.FC = () => {
  const [userMenuOpen, setUserMenuOpen] = React.useState<boolean>(false);
  const [helpMenuOpen, setHelpMenuOpen] = React.useState<boolean>(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = React.useState<boolean>(false);
  const [segmentKeyModalOpen, setSegmentKeyModalOpen] = React.useState<boolean>(false);
  const [segmentKey, setSegmentKey] = React.useState<string>('');
  const [segmentKeyEnabled, setSegmentKeyEnabled] = React.useState<boolean>(false);
  const username = useSelector(state => (state as any).appReducer.user?.name);
  console.log(username);

  // notify segment key enabled
  React.useEffect(() => {
    if (username && segmentKey && segmentKeyEnabled) {
      initSegment({ segmentKey, username });
    }
  }, [username, segmentKey, segmentKeyEnabled]);

  const handleLogout = () => {
    setUserMenuOpen(false);
    fetch('/oauth/sign_out')
      .then(() => console.log('logged out'))
      .catch((err) => console.error(err))
      .finally(() => window.location.reload());
  };

  const userMenuItems = [
    <DropdownItem key="logout" onClick={handleLogout}>
      Log out
    </DropdownItem>,
  ];

  const handleHelpClick = () => {
    setHelpMenuOpen(false);
  };

  const helpMenuItems = [
    <DropdownItem
      key="documentation"
      onClick={handleHelpClick}
      className="odh-dashboard__external-link"
      href={DOC_LINK}
      target="_blank"
      rel="noopener noreferrer"
    >
      Documentation
      <ExternalLinkAltIcon />
    </DropdownItem>,
    <DropdownItem
      key="support"
      onClick={handleHelpClick}
      className="odh-dashboard__external-link"
      href={SUPPORT_LINK}
      target="_blank"
      rel="noopener noreferrer"
    >
      Support
      <ExternalLinkAltIcon />
    </DropdownItem>,
  ];

  const handleSegmentKeySettingsClick = () => {
    setSettingsMenuOpen(false);
    setSegmentKeyModalOpen(true);
  }

  const settingsMenuItems = [
    <DropdownItem key="segment-key" onClick={handleSegmentKeySettingsClick}>
      Segment Key
    </DropdownItem>
  ];

  return (
    <>
      <PageHeaderTools>
        <PageHeaderToolsGroup className="hidden-xs">
          <PageHeaderToolsItem>
            <Dropdown
              position={DropdownPosition.right}
              toggle={
                <DropdownToggle
                  id="toggle-id"
                  onToggle={() => setSettingsMenuOpen(!settingsMenuOpen)}
                  toggleIndicator={CaretDownIcon}
                >
                  <CogIcon />
                </DropdownToggle>
              }
              isOpen={settingsMenuOpen}
              dropdownItems={settingsMenuItems}
            />
          </PageHeaderToolsItem>
          <PageHeaderToolsItem>
            <Dropdown
              position={DropdownPosition.right}
              toggle={
                <DropdownToggle
                  id="toggle-id"
                  onToggle={() => setHelpMenuOpen(!helpMenuOpen)}
                  toggleIndicator={CaretDownIcon}
                >
                  <QuestionCircleIcon />
                </DropdownToggle>
              }
              isOpen={helpMenuOpen}
              dropdownItems={helpMenuItems}
            />
          </PageHeaderToolsItem>
          <PageHeaderToolsItem>
            <Dropdown
              position={DropdownPosition.right}
              toggle={
                <DropdownToggle
                  id="toggle-id"
                  onToggle={() => setUserMenuOpen(!userMenuOpen)}
                  toggleIndicator={CaretDownIcon}
                >
                  <UserIcon className="odh-dashboard__user-icon" />
                </DropdownToggle>
              }
              isOpen={userMenuOpen}
              dropdownItems={userMenuItems}
            />
          </PageHeaderToolsItem>
        </PageHeaderToolsGroup>
      </PageHeaderTools>
      {segmentKeyModalOpen ? (
        <SegmentKeyModal
          segmentKey={segmentKey}
          setSegmentKey={setSegmentKey}
          segmentKeyEnabled={segmentKeyEnabled}
          setSegmentKeyEnabled={setSegmentKeyEnabled}
          onClose={() => setSegmentKeyModalOpen(false)}
        />
      ) : null}
    </>
  );
};

export default HeaderTools;
