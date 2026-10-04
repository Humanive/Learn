/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Learn Executable - Path to the Learn CLI installed from Humanive/Learn; see About This Extension for setup */
  "learnExecutable": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `save-current-browser-url` command */
  export type SaveCurrentBrowserUrl = ExtensionPreferences & {}
  /** Preferences accessible in the `browse-resources` command */
  export type BrowseResources = ExtensionPreferences & {}
  /** Preferences accessible in the `add-resource` command */
  export type AddResource = ExtensionPreferences & {}
  /** Preferences accessible in the `create-workspace` command */
  export type CreateWorkspace = ExtensionPreferences & {}
  /** Preferences accessible in the `choose-workspace` command */
  export type ChooseWorkspace = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `save-current-browser-url` command */
  export type SaveCurrentBrowserUrl = {}
  /** Arguments passed to the `browse-resources` command */
  export type BrowseResources = {}
  /** Arguments passed to the `add-resource` command */
  export type AddResource = {}
  /** Arguments passed to the `create-workspace` command */
  export type CreateWorkspace = {}
  /** Arguments passed to the `choose-workspace` command */
  export type ChooseWorkspace = {}
}

