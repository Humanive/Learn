import {
  Action,
  ActionPanel,
  BrowserExtension,
  getFrontmostApplication,
  List,
  LocalStorage,
  showHUD,
  showToast,
  Toast,
} from '@raycast/api';
import { usePromise } from '@raycast/utils';
import { useEffect, useState } from 'react';
import {
  captureBrowserUrl,
  CAPTURE_WORKSPACE_KEY,
  getSavedCaptureWorkspace,
  type CaptureResult,
} from './capture.js';
import { getActiveBrowserTabs, type BrowserTab } from './browser.js';
import { listLearnWorkspaces, runLearn } from './learn-cli.js';
import { getLearnExecutable } from './preferences.js';

interface CaptureContext {
  tabs: BrowserTab[];
  workspaces: string[];
  savedWorkspace?: string;
}

export default function SaveCurrentBrowserUrl() {
  const executable = getLearnExecutable();
  const { data, isLoading, error } = usePromise(
    () => loadCaptureContext(executable),
    [],
    { onError: () => undefined, failureToastOptions: { title: 'Could not save browser URL' } }
  );

  if (error) return <ErrorView message={error.message} />;
  if (isLoading || !data) {
    return <List isLoading searchBarPlaceholder="Reading current browser tab…" />;
  }

  return <CaptureFlow context={data} executable={executable} />;
}

async function loadCaptureContext(executable: string): Promise<CaptureContext> {
  const application = await getFrontmostApplication();
  const [tabs, workspaces] = await Promise.all([
    BrowserExtension.getTabs(),
    listLearnWorkspaces(executable),
  ]);
  const activeTabs = getActiveBrowserTabs({ applicationName: application.name, tabs });
  if (workspaces.length === 0) {
    throw new Error('No Learn workspace found. Create one with: learn new <name>');
  }

  return {
    tabs: activeTabs,
    workspaces,
    savedWorkspace: await getSavedCaptureWorkspace({
      listWorkspaces: async () => workspaces,
      store: LocalStorage,
    }),
  };
}

function CaptureFlow({ context, executable }: { context: CaptureContext; executable: string }) {
  const [selectedTab, setSelectedTab] = useState<BrowserTab | undefined>(
    context.tabs.length === 1 ? context.tabs[0] : undefined
  );

  if (!selectedTab) {
    return <BrowserTabPicker tabs={context.tabs} onSelect={setSelectedTab} />;
  }
  if (context.savedWorkspace) {
    return <SavingView tab={selectedTab} workspace={context.savedWorkspace} executable={executable} />;
  }
  return (
    <WorkspacePicker
      tab={selectedTab}
      workspaces={context.workspaces}
      executable={executable}
    />
  );
}

function BrowserTabPicker({
  tabs,
  onSelect,
}: {
  tabs: BrowserTab[];
  onSelect: (tab: BrowserTab) => void;
}) {
  return (
    <List searchBarPlaceholder="Choose the browser window to save">
      {tabs.map((tab) => (
        <List.Item
          key={tab.id}
          title={tab.title || tab.url}
          subtitle={tab.url}
          actions={
            <ActionPanel>
              <Action title="Save This Tab" onAction={() => onSelect(tab)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function SavingView({
  tab,
  workspace,
  executable,
}: {
  tab: BrowserTab;
  workspace: string;
  executable: string;
}) {
  const { data, error } = usePromise(
    () => saveToWorkspace(tab, workspace, executable),
    [],
    { onError: () => undefined, failureToastOptions: { title: 'Could not save browser URL' } }
  );

  if (error) return <ErrorView message={error.message} />;
  if (!data) return <List isLoading searchBarPlaceholder="Saving browser URL…" />;
  return <ResultView result={data} title={tab.title} workspace={workspace} />;
}

function WorkspacePicker({
  tab,
  workspaces,
  executable,
}: {
  tab: BrowserTab;
  workspaces: string[];
  executable: string;
}) {
  return (
    <List searchBarPlaceholder="Choose a Learn workspace">
      {workspaces.map((workspace) => (
        <List.Item
          key={workspace}
          title={workspace}
          subtitle={tab.title || tab.url}
          actions={
            <ActionPanel>
              <Action
                title="Save to Workspace"
                onAction={() => saveSelectedWorkspace(tab, workspace, executable)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

async function saveSelectedWorkspace(
  tab: BrowserTab,
  workspace: string,
  executable: string
): Promise<void> {
  try {
    const result = await saveToWorkspace(tab, workspace, executable);
    if (result.status === 'saved') {
      await LocalStorage.setItem(CAPTURE_WORKSPACE_KEY, workspace);
    }
    await showResultToast(result, tab.title, workspace);
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: 'Could not save browser URL',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function saveToWorkspace(
  tab: BrowserTab,
  workspace: string,
  executable: string
): Promise<CaptureResult> {
  return captureBrowserUrl({
    url: tab.url,
    title: tab.title,
    workspace,
    runLearn: (args) => runLearn(args, executable),
  });
}

async function showResultToast(
  result: CaptureResult,
  title: string | undefined,
  workspace: string
): Promise<void> {
  if (result.status === 'duplicate') {
    await showToast({
      style: Toast.Style.Failure,
      title: 'Already saved',
      message: `This URL is already in ${workspace}`,
    });
    return;
  }

  await showHUD(title ? `Saved “${title}” to ${workspace}` : `Saved URL to ${workspace}`);
}

function ResultView({ result, title, workspace }: {
  result: CaptureResult;
  title?: string;
  workspace: string;
}) {
  useEffect(() => {
    void showResultToast(result, title, workspace);
  }, [result, title, workspace]);
  return <List searchBarPlaceholder="Browser URL saved" />;
}

function ErrorView({ message }: { message: string }) {
  useEffect(() => {
    void showToast({ style: Toast.Style.Failure, title: 'Could not save browser URL', message });
  }, [message]);
  return <List searchBarPlaceholder="Could not save browser URL" />;
}
