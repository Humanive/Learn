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
  /** Preferences accessible in the `choose-workspace` command */
  export type ChooseWorkspace = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `save-current-browser-url` command */
  export type SaveCurrentBrowserUrl = {}
  /** Arguments passed to the `choose-workspace` command */
  export type ChooseWorkspace = {}
}

