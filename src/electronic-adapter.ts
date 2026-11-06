import { SyncEngine } from "./sync-engine";
import { freshState } from "./sync-model";
import type { AcademyData } from "./types";
import { electronicData, patchElectronic } from "./academy-model";
import type { AcademyEngine } from "./academy-engine";
// Preserve the mature electronic-music pages as a view over shared definitions
// and the current author's records; never store their combined projection remotely.
export class ElectronicAdapter extends SyncEngine {
  constructor(readonly academy: AcademyEngine) {
    super(
      academy.state.uid,
      freshState(electronicData(academy.state.documents, academy.state.uid)),
      {
        read: async () => [],
        write: async () => {
          throw new Error("Use academy synchronization");
        },
        upload: async (a) => a,
      },
      () => {},
    );
    this.refresh();
  }
  refresh() {
    this.state = {
      ...this.state,
      data: electronicData(
        this.academy.state.documents,
        this.academy.state.uid,
      ),
      initialized: true,
    };
    this.status = this.academy.status;
    this.error = this.academy.error;
    this.uploading = this.academy.uploading;
  }
  override edit(change: AcademyData | ((data: AcademyData) => AcademyData)) {
    const before = electronicData(
        this.academy.state.documents,
        this.academy.state.uid,
      ),
      after = typeof change === "function" ? change(before) : change;
    const patches = patchElectronic(before, after, this.academy.state.uid);
    for (const d of patches) this.academy.edit(d);
    this.refresh();
  }
  override async restore(data: AcademyData) {
    await this.academy.importElectronic(data);
    this.refresh();
  }
  override async sync() {
    await this.academy.sync();
    this.refresh();
  }
}
