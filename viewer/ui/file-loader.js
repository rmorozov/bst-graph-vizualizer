/**
 * File Loader for BuildStream Graph Viewer
 * 
 * Implements T2.2: File loading with validation-before-swap and large-file warning
 * - Loading a 2nd valid file after a working 1st session fully replaces state only after validation succeeds
 * - Loading an invalid 2nd file leaves the 1st graph fully intact, interactive, with an error toast shown
 * - A file above 200MB triggers a confirmation dialog before JSON.parse is invoked
 */

import { validateGraphData, formatValidationErrors } from '../core/schema-validate.js';

const LARGE_FILE_THRESHOLD_BYTES = 200 * 1024 * 1024; // 200MB

/**
 * FileLoaderResult interface
 */
export interface FileLoaderResult {
  success: boolean;
  data?: any;
  error?: string;
  requiresConfirmation?: boolean;
  fileSizeMB?: number;
}

/**
 * Current loaded state (for rollback on failed loads)
 */
let currentState: any = null;
let currentFileName: string | null = null;

/**
 * Load a file with validation and large-file warning
 * 
 * @param file - The File object to load
 * @param onStateChange - Callback to invoke when state successfully changes
 * @param onError - Callback to invoke on error (with toast message)
 * @returns Promise<FileLoaderResult>
 */
export async function loadFile(
  file: File,
  onStateChange: (data: any, fileName: string) => void,
  onError: (message: string) => void
): Promise<FileLoaderResult> {
  const fileSizeMB = file.size / (1024 * 1024);
  
  // Check if file exceeds threshold
  if (file.size > LARGE_FILE_THRESHOLD_BYTES) {
    return {
      success: false,
      requiresConfirmation: true,
      fileSizeMB: Math.round(fileSizeMB * 100) / 100
    };
  }
  
  return await processFile(file, onStateChange, onError);
}

/**
 * Confirm and load a large file (called after user confirms)
 */
export async function confirmAndLoadLargeFile(
  file: File,
  onStateChange: (data: any, fileName: string) => void,
  onError: (message: string) => void
): Promise<FileLoaderResult> {
  return await processFile(file, onStateChange, onError);
}

/**
 * Internal file processing logic
 */
async function processFile(
  file: File,
  onStateChange: (data: any, fileName: string) => void,
  onError: (message: string) => void
): Promise<FileLoaderResult> {
  try {
    const text = await readFileAsText(file);
    
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      const errorMsg = `Invalid JSON: ${(parseError as Error).message}`;
      onError(errorMsg);
      return {
        success: false,
        error: errorMsg
      };
    }
    
    // Validate against schema BEFORE swapping state
    const validationResult = validateGraphData(parsed);
    
    if (!validationResult.valid) {
      // Rollback: keep old state intact
      const errorMsg = formatValidationErrors(validationResult);
      onError(errorMsg);
      return {
        success: false,
        error: errorMsg
      };
    }
    
    // Validation passed: swap state atomically
    currentState = parsed;
    currentFileName = file.name;
    onStateChange(parsed, file.name);
    
    return {
      success: true,
      data: parsed
    };
    
  } catch (error) {
    const errorMsg = `Failed to load file: ${(error as Error).message}`;
    onError(errorMsg);
    return {
      success: false,
      error: errorMsg
    };
  }
}

/**
 * Read file as text with progress tracking
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('Failed to read file as text'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('File read error'));
    };
    
    reader.readAsText(file);
  });
}

/**
 * Get current loaded state (for diagnostic purposes)
 */
export function getCurrentState(): any {
  return currentState;
}

/**
 * Get current file name
 */
export function getCurrentFileName(): string | null {
  return currentFileName;
}

/**
 * Clear current state (for reset functionality)
 */
export function clearState(): void {
  currentState = null;
  currentFileName = null;
}

export default {
  loadFile,
  confirmAndLoadLargeFile,
  getCurrentState,
  getCurrentFileName,
  clearState
};
