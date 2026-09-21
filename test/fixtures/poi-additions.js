// Future optional fields at every POI object level, excluding ID-keyed maps.
export function extendedPois() {
  const extra = value => ({ ...value, futureAttribute: { nested: [1, null, true] } });
  const timer = () => extra({ progress: .5, remainingSeconds: 30, totalSeconds: 60 });
  const poi = (id, kind, fields) => extra({ id, kind, position: extra({ x: 1, y: 2 }), observedAtGameTime: 0, ...fields });
  return {
    shop: poi('shop', 'goblin-merchant', { offers: [extra({ id: 'item:boot', kind: 'item', typeId: 'boot',
      cost: extra({ gold: 250, lumber: 0 }), stock: extra({ current: 1, max: 2 }),
      initialAvailability: timer(), restock: timer(), cooldown: timer(),
      eligibility: { '0': extra({ available: false, reasons: ['gold'] }) }
    })], nextStockUpdate: timer() }),
    fountain: poi('fountain', 'fountain', { fountain: extra({ restores: ['health'], active: true }) }),
    mine: poi('mine', 'gold-mine', { mine: extra({ remainingGold: 1000, ownerPlayerId: null }) }),
    gate: poi('gate', 'way-gate', { wayGate: extra({ enabled: true, destination: extra({ x: 3, y: 4 }) }) }),
    camp: poi('camp', 'creep-camp', { camp: extra({ state: 'alive', members: [extra({
      id: '0000000000000002', typeId: 'nogr', alive: true, position: extra({ x: 5, y: 6 }),
      hitpoints: extra({ current: 100, max: 200 })
    })], dropTable: [extra({ itemClass: 'permanent', level: 3, probability: .5 })] }) })
  };
}
