import * as React from 'react';
import { ExpandableSection, Label, Radio } from '@patternfly/react-core';
import { StarIcon } from '@patternfly/react-icons';
import { ImageStream, ImageStreamTag } from '../../types';
import ImageStreamTagPopover from './ImageStreamTagPopover';
import { compareTagVersions, getTagDescription, getVersion, isImageStreamTagBuildValid } from '../../utilities/imageUtils';
import { ANNOTATION_NOTEBOOK_IMAGE_TAG_RECOMMENDED } from '../../utilities/const';
import './NotebookController.scss';
import AppContext from 'app/AppContext';

type ImageVersionsProps = {
  imageStream: ImageStream;
  tags: ImageStreamTag[];
  selectedTag?: ImageStreamTag;
  onSelect: (tag: ImageStreamTag, selected: boolean) => void;
};

const ImageStreamVersions: React.FC<ImageVersionsProps> = ({
  imageStream,
  tags,
  selectedTag,
  onSelect,
}) => {
  const { buildStatuses } = React.useContext(AppContext);
  const [isExpanded, setExpanded] = React.useState<boolean>(false);
  const name = imageStream.metadata.name;
  const onToggle = (isOpen: boolean) => {
    setExpanded(isOpen);
  };
  if (tags.length < 2) {
    return null;
  }

  return (
    <ExpandableSection
      toggleText="Versions"
      onToggle={onToggle}
      isExpanded={isExpanded}
      className="odh-notebook-controller__notebook-image-tags"
    >
      {tags.sort(compareTagVersions).map((tag: ImageStreamTag) => {
        const disabled = !isImageStreamTagBuildValid(buildStatuses, imageStream, tag);
        return (
          <Radio
            key={`${name}:${tag.name}`}
            id={`${name}:${tag.name}`}
            name={`${name}:${tag.name}`}
            className="odh-notebook-controller__notebook-image-option"
            isDisabled={disabled}
            label={
              <span className="odh-notebook-controller__notebook-image-title">
                Version{` ${getVersion(tag.name)}`}
                <ImageStreamTagPopover tag={tag} />
                {tag?.annotations?.[ANNOTATION_NOTEBOOK_IMAGE_TAG_RECOMMENDED] ? (
                  <Label color="blue" icon={<StarIcon />}>
                    Recommended
                  </Label>
                ) : null}
              </span>
            }
            description={getTagDescription(tag)}
            isChecked={tag.name === selectedTag?.name}
            onChange={(checked: boolean) => onSelect(tag, checked)}
          />
        );
      })}
    </ExpandableSection>
  );
};

export default ImageStreamVersions;
