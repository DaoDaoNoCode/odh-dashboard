import * as React from 'react';
import {
  ActionGroup,
  Button,
  Form,
  FormGroup,
  FormSection,
  Grid,
  GridItem,
  Select,
  SelectOption,
} from '@patternfly/react-core';
import { checkOrder, getDefaultTag } from '../../utilities/imageUtils';
import {
  EnvVarCategoryType,
  ImageInfo,
  ImageTag,
  VariableRow,
  ImageTagInfo,
} from '../../types';
import ImageSelector from './ImageSelector';
import EnvironmentVariablesRow from './EnvironmentVariablesRow';
import { mockUIConfig } from './mock';
import { CUSTOM_VARIABLE, EMPTY_KEY } from './const';
import { PlusCircleIcon } from '@patternfly/react-icons';
import { useHistory } from 'react-router';
import { createNotebook } from 'services/notebookService';
import { createPvc, getPvc } from 'services/pvcService';
import { useSelector } from 'react-redux';
import { State } from 'redux/types';
import { generateNotebookNameFromUsername, generatePvcNameFromUsername } from 'utilities/utils';
import AppContext from 'app/AppContext';

import './NotebookController.scss';
import StartServerModal from './StartServerModal';

type SpawnerPageProps = {
  images: ImageInfo[];
  odhConfig: any;
  updateNotebook: () => void;
};

const SpawnerPage: React.FC<SpawnerPageProps> = React.memo(({ images, odhConfig, updateNotebook }) => {
  const history = useHistory();
  const { buildStatuses } = React.useContext(AppContext);
  const [selectedImageTag, setSelectedImageTag] = React.useState<ImageTag>({
    image: undefined,
    tag: undefined,
  });
  const [sizeDropdownOpen, setSizeDropdownOpen] = React.useState(false);
  const [selectedSize, setSelectedSize] = React.useState<string>('Default');
  const [gpuDropdownOpen, setGpuDropdownOpen] = React.useState(false);
  const [selectedGpu, setSelectedGpu] = React.useState<string>('0');
  const [variableRows, setVariableRows] = React.useState<VariableRow[]>([]);
  const [startShown, setStartShown] = React.useState<boolean>(false);
  const username = useSelector<State, string>((state) => state.appState.user || '');

  React.useEffect(() => {
    setFirstValidImage();
  }, []);

  const setFirstValidImage = () => {
    let found = false;
    let i = 0;
    while (!found && i < images.length) {
      const image = images[i++];
      if (image) {
        const tag = getDefaultTag(buildStatuses, image);
        if (tag) {
          const values = { image, tag };
          setSelectedImageTag(values);
          found = true;
        }
      }
    }
  };

  const handleImageTagSelection = (
    image: ImageInfo,
    tag: ImageTagInfo,
    checked: boolean,
  ) => {
    if (checked) {
      setSelectedImageTag({ image, tag });
    }
  };

  const handleSizeSelection = (e, selection) => {
    setSelectedSize(selection);
    setSizeDropdownOpen(false);
  };

  const handleGpuSelection = (e, selection) => {
    setSelectedGpu(selection);
    setGpuDropdownOpen(false);
  };

  const sizeOptions = React.useMemo(() => {
    const sizes = odhConfig?.spec?.notebookSizes;
    if (!sizes?.length) {
      return [<SelectOption key="Default" value="Default" description="No Size Limits" />];
    }

    return sizes.map((size) => {
      const name = size.name;
      const desc =
        size.description ||
        `Limits: ${size?.resources?.limits?.cpu || '??'} CPU, ` +
          `${size?.resources?.limits?.memory || '??'} Memory ` +
          `Requests: ${size?.resources?.requests?.cpu || '??'} CPU, ` +
          `${size?.resources?.requests?.memory || '??'} Memory`;
      return <SelectOption key={name} value={name} description={desc} />;
    });
  }, [odhConfig]);

  const gpuOptions = React.useMemo(() => {
    const values: number[] = [];
    const start = 0;
    const end = 5;

    for (let i = start; i <= end; i++) {
      values.push(i);
    }
    return values?.map((gpuSize) => <SelectOption key={gpuSize} value={`${gpuSize}`} />);
  }, []);

  const renderEnvironmentVariableRows = () => {
    if (!variableRows?.length) {
      return null;
    }
    return variableRows.map((row, index) => (
      <EnvironmentVariablesRow
        key={`environment-variable-row-${index}`}
        categories={(mockUIConfig.envVarConfig.categories as EnvVarCategoryType[]) || []}
        variableRow={row}
        onUpdate={(updatedRow) => onUpdateRow(index, updatedRow)}
      />
    ));
  };

  const onUpdateRow = (index: number, updatedRow?: VariableRow) => {
    const updatedRows = [...variableRows];

    if (!updatedRow) {
      updatedRows.splice(index, 1); // remove the whole variable at the index
      setVariableRows(updatedRows);
      return;
    }

    updatedRows[index] = { ...updatedRow };
    updatedRows[index].errors = {};
    for (let i = 0; i < updatedRows.length; i++) {
      if (i !== index) {
        updatedRow.variables.forEach((variable) => {
          if (updatedRows[i].variables.find((v) => v.name === variable.name)) {
            updatedRows[index].errors[variable.name] =
              'That name is already in use. Try a different name.';
          }
        });
      }
    }
    setVariableRows(updatedRows);
  };

  const addEnvironmentVariableRow = () => {
    const newRow: VariableRow = {
      variableType: CUSTOM_VARIABLE,
      variables: [
        {
          name: EMPTY_KEY,
          type: 'text',
          value: '',
        },
      ],
      errors: {},
    };
    setVariableRows([...variableRows, newRow]);
  };

  const handleNotebookAction = async () => {
    const notebookSize = odhConfig?.spec?.notebookSizes?.find((ns) => ns.name === selectedSize);
    try {
      const pvcName = generatePvcNameFromUsername(username);
      const pvc = await getPvc(pvcName);
      if (!pvc) {
        await createPvc(pvcName, '20Gi');
      }
      const volumes = [{ name: pvcName, persistentVolumeClaim: { claimName: pvcName }}];
      const volumeMounts = [{ mountPath: '/home/jovyan', name: pvcName }];
      const notebookName = generateNotebookNameFromUsername(username);
      await createNotebook(
        notebookName,
        selectedImageTag.tag,
        notebookSize,
        parseInt(selectedGpu),
        volumes,
        volumeMounts
      );
      updateNotebook();
    } catch (e) {
      console.log(e);
    }
  };

  return (
    <>
      <Form className="odh-notebook-controller__page odh-notebook-controller__page-form">
        <FormSection title="Notebook image">
          <FormGroup fieldId="modal-notebook-image">
            <Grid sm={12} md={12} lg={12} xl={6} xl2={6} hasGutter>
              {images.sort(checkOrder).map((image) => (
                <GridItem key={image.name}>
                  <ImageSelector
                    image={image}
                    selectedImage={selectedImageTag.image}
                    selectedTag={selectedImageTag.tag}
                    handleSelection={handleImageTagSelection}
                  />
                </GridItem>
              ))}
            </Grid>
          </FormGroup>
        </FormSection>
        <FormSection title="Deployment size">
          {sizeOptions && (
            <FormGroup label="Container size" fieldId="modal-notebook-container-size">
              <Select
                isOpen={sizeDropdownOpen}
                onToggle={() => setSizeDropdownOpen(!sizeDropdownOpen)}
                aria-labelledby="container-size"
                selections={selectedSize}
                onSelect={handleSizeSelection}
                menuAppendTo="parent"
              >
                {sizeOptions}
              </Select>
            </FormGroup>
          )}
          {gpuOptions && (
            <FormGroup label="Number of GPUs" fieldId="modal-notebook-gpu-number">
              <Select
                isOpen={gpuDropdownOpen}
                onToggle={() => setGpuDropdownOpen(!gpuDropdownOpen)}
                aria-labelledby="gpu-numbers"
                selections={selectedGpu}
                onSelect={handleGpuSelection}
                menuAppendTo="parent"
              >
                {gpuOptions}
              </Select>
            </FormGroup>
          )}
        </FormSection>
        <FormSection title="Environment variables" className="odh-notebook-controller__env-var">
          {renderEnvironmentVariableRows()}
          <Button
            className="odh-notebook-controller__env-var-add-button"
            isInline
            variant="link"
            onClick={addEnvironmentVariableRow}
          >
            <PlusCircleIcon />
            {` Add more variables`}
          </Button>
        </FormSection>
        <ActionGroup>
          <Button variant="primary" onClick={handleNotebookAction}>Start server</Button>
          <Button variant="secondary" onClick={() => history.push('/')}>
            Cancel
          </Button>
        </ActionGroup>
      </Form>
      {startShown && <StartServerModal startShown={startShown} onClose={() => setStartShown(false)}/>}
    </>
  );
});

SpawnerPage.displayName = 'SpawnerPage';

export default SpawnerPage;
