import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActivityView } from "./activity-view";
import { DevicesView } from "./devices-view";
import { GroupsView } from "./groups-view";
import { LicensesView } from "./licenses-view";
import { StorageView } from "./storage-view";

describe("dashboard resource views", () => {
  it.each([
    ["Aktywność synchronizacji", <ActivityView entries={[]} key="activity" />],
    ["Urządzenia", <DevicesView devices={[]} nowMs={0} key="devices" />],
    ["Licencje", <LicensesView licenses={[]} groups={[]} key="licenses" />],
    [
      "Grupy",
      <GroupsView groups={[]} storageBackends={[]} licenses={[]} key="groups" />,
    ],
    ["Storage", <StorageView storageBackends={[]} key="storage" />],
  ])("renders the %s empty state", (title, view) => {
    render(view);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(/Brak/)).toBeInTheDocument();
  });
});
