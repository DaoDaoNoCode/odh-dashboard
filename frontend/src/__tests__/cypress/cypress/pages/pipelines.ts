class PipelineDetails {
  visit(namespace: string, pipelineId: string) {
    cy.visitWithLogin(`/pipelines/${namespace}/pipeline/view/${pipelineId}`);
    this.wait();
  }

  private wait() {
    cy.get('[data-test-id="topology"]');
    cy.testA11y();
  }

  findTaskNode(name: string) {
    return cy.get(`[data-id="${name}"][data-kind="node"][data-type="DEFAULT_TASK_NODE"]`);
  }

  findTaskDrawer() {
    return cy.findByTestId('task-drawer');
  }

  findCloseDrawerButton() {
    return this.findTaskDrawer().findByRole('button', { name: 'Close drawer panel' });
  }
}

export const pipelineDetails = new PipelineDetails();
