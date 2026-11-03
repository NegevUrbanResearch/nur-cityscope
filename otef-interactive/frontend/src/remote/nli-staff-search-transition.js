export function createNliStaffSearchTransition({ clearPersonSelection, cancelPlaceFocus, hasPlaceFocus, waitForPlaceNavigation } = {}) {
  let generation = 0;
  const isCurrent = (token) => token === generation;
  const clearPerson = async (token) => {
    if (!isCurrent(token)) return false;
    try {
      const cleared = await clearPersonSelection?.();
      return isCurrent(token) && cleared === true;
    } catch {
      return false;
    }
  };
  const clearPlace = async (token) => {
    if (!isCurrent(token)) return false;
    try {
      if (waitForPlaceNavigation) await waitForPlaceNavigation();
      if (!isCurrent(token)) return false;
      if (!hasPlaceFocus?.()) return true;
      const result = await cancelPlaceFocus?.();
      const acknowledged = result?.ok === true || result?.status === "ok";
      return isCurrent(token) && acknowledged;
    } catch {
      return false;
    }
  };
  return {
    begin() { generation += 1; return generation; },
    isCurrent,
    async clearAll(token) {
      if (!await clearPerson(token)) return false;
      return clearPlace(token);
    },
    beforePerson: clearPlace,
    beforePlace: clearPerson,
  };
}
