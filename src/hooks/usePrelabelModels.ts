import { useEffect, useState } from "react";
import { loadPrelabelModelLibrary, savePrelabelModelLibrary } from "../lib/tauri-api";
import {
  EMPTY_PRELABEL_MODEL_LIBRARY,
  type PrelabelModelConfig,
  type PrelabelModelLibrary,
} from "../types/prelabel";
import {
  addModelToLibrary,
  deleteModelFromLibrary,
  selectModelInLibrary,
  updateModelInLibrary,
} from "../lib/prelabel-models";
import { PRELABEL_ZH_CN } from "../i18n/prelabel.zh-CN";

export function usePrelabelModels(setError: (message: string) => void) {
  const [library, setLibrary] = useState<PrelabelModelLibrary>(EMPTY_PRELABEL_MODEL_LIBRARY);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void loadPrelabelModelLibrary()
      .then((loaded) => {
        if (active) {
          setLibrary(loaded);
          setIsLoaded(true);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(PRELABEL_ZH_CN.loadFailed(reason));
          setIsLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [setError]);

  async function persist(nextLibrary: PrelabelModelLibrary) {
    await savePrelabelModelLibrary(nextLibrary);
    setLibrary(nextLibrary);
  }

  async function addModel(model: PrelabelModelConfig) {
    await persist(addModelToLibrary(library, model));
  }

  async function updateModel(model: PrelabelModelConfig) {
    await persist(updateModelInLibrary(library, model));
  }

  async function deleteModel(modelId: string) {
    await persist(deleteModelFromLibrary(library, modelId));
  }

  async function selectModel(modelId: string) {
    await persist(selectModelInLibrary(library, modelId));
  }

  return { addModel, deleteModel, isLoaded, library, selectModel, updateModel };
}
