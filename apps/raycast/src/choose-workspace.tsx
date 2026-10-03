import {
  Action,
  ActionPanel,
  List,
  LocalStorage,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect } from "react";
import { CAPTURE_WORKSPACE_KEY } from "./capture.js";
import { listLearnWorkspaces } from "./learn-cli.js";
import { getLearnExecutable } from "./preferences.js";

export default function ChooseWorkspace() {
  const executable = getLearnExecutable();
  const {
    data: workspaces,
    isLoading,
    error,
  } = usePromise(listLearnWorkspaces, [executable], {
    onError: () => undefined,
    failureToastOptions: { title: "Could not list Learn workspaces" },
  });

  useEffect(() => {
    if (!error) return;
    void showToast({
      style: Toast.Style.Failure,
      title: "Could not list Learn workspaces",
      message: error.message,
    });
  }, [error]);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Choose a Learn workspace">
      {(workspaces || []).map((workspace) => (
        <List.Item
          key={workspace}
          title={workspace}
          actions={
            <ActionPanel>
              <Action
                title="Use Workspace"
                onAction={async () => {
                  await LocalStorage.setItem(CAPTURE_WORKSPACE_KEY, workspace);
                  await showToast({
                    style: Toast.Style.Success,
                    title: `Using ${workspace}`,
                  });
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
