import * as React from 'react';
import {
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  ExpandableSection,
  Text,
  TextVariants,
} from '@patternfly/react-core';
import { ImageInfo, Notebook, NotebookContainer } from '../../types';
import { getDescriptionForTag, getImageTagByContainer, getNameVersionString, getNumGpus } from 'utilities/imageUtils';

type NotebookServerDetailsProps = {
  notebook: Notebook;
  images: ImageInfo[];
}

const NotebookServerDetails: React.FC<NotebookServerDetailsProps> = ({
  notebook,
  images
}) => {
  const [isExpanded, setExpanded] = React.useState(false);

  const empty = React.useCallback(
    () => (
      <div>Error load notebook details</div>
    ),
    [notebook]
  );

  const container: NotebookContainer | undefined = notebook.spec?.template?.spec?.containers?.find(
    container => container.name === notebook.metadata.name
  );
  console.log(container)
  if (!container) {
    return empty();
  };

  const { image, tag } = getImageTagByContainer(images, container);

  if (!image || !tag) {
    return empty();
  };
  const tagSoftware = getDescriptionForTag(tag);
  const tagDependencies = tag.content.dependencies ?? [];
  const numGpus = getNumGpus(container);

  const onToggle = (expanded: boolean) => setExpanded(expanded);

  return (
    <ExpandableSection
      className="odh-notebook-controller__server-details"
      toggleText="Notebook server details"
      onToggle={onToggle}
      isExpanded={isExpanded}
      isIndented
    >
      <p className="odh-notebook-controller__server-details-title">Notebook image</p>
      <div className="odh-notebook-controller__server-details-image-name">
        <p>{image.display_name}</p>
        {tagSoftware && <Text component={TextVariants.small}>{tagSoftware}</Text>}
      </div>
      <DescriptionList>
        <DescriptionListGroup>
          <DescriptionListTerm>Packages</DescriptionListTerm>
          <DescriptionListDescription>
            {tagDependencies.length !== 0
              && tagDependencies.map((dependency, index) => (
                <p key={`imagestream-tag-dependency-${index}`}>
                  {getNameVersionString(dependency)}
                </p>
              ))
            }
          </DescriptionListDescription>
        </DescriptionListGroup>
      </DescriptionList>
      <p className="odh-notebook-controller__server-details-title">Deployment size</p>
      <DescriptionList isCompact>
        <DescriptionListGroup>
          <DescriptionListTerm>Container size</DescriptionListTerm>
          <DescriptionListDescription>Default</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Limits</DescriptionListTerm>
          <DescriptionListDescription>{`${container.resources?.limits?.cpu} CPU, ${container.resources?.limits?.memory} Memory`}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Memory Requests</DescriptionListTerm>
          <DescriptionListDescription>{`${container.resources?.requests?.cpu} CPU, ${container.resources?.requests?.memory} Memory`}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Number of GPUs</DescriptionListTerm>
          <DescriptionListDescription>{numGpus}</DescriptionListDescription>
        </DescriptionListGroup>
      </DescriptionList>
    </ExpandableSection>
  );
};

NotebookServerDetails.displayName = 'NotebookServerDetails';

export default NotebookServerDetails;
