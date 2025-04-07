import { useState, useRef } from 'react';
import { toJpeg } from 'html-to-image';

const defaultTiers = [
  { id: '1', from: 1, to: 200, rate: 0.218 },
  { id: '2', from: 201, to: 300, rate: 0.334 },
  { id: '3', from: 301, to: 600, rate: 0.516 },
  { id: '4', from: 601, to: Infinity, rate: 0.546 },
];

export default function App() {
  const [tiers, setTiers] = useState(defaultTiers);
  const [rentals, setRentals] = useState([]);
  const resultRef = useRef(null);

  // Tier management
  const addTier = () => {
    const newTier = {
      id: Date.now().toString(),
      from: tiers[tiers.length - 1].to + 1,
      to: tiers[tiers.length - 1].to + 100,
      rate: 0.3,
    };
    setTiers([...tiers.slice(0, -1), newTier, tiers[tiers.length - 1]]);
  };

  const updateTier = (id, field, value) => {
    const newTiers = tiers.map(tier => 
      tier.id === id ? { ...tier, [field]: Number(value) } : tier
    ).sort((a, b) => a.from - b.from);
    setTiers(newTiers);
  };

  // Rental management
  const addRental = () => {
    setRentals([...rentals, { id: Date.now().toString(), name: '', kWh: 0 }]);
  };

  const updateRental = (id, field, value) => {
    setRentals(rentals.map(rental =>
      rental.id === id ? { ...rental, [field]: value } : rental
    ));
  };

  // Calculation logic
  const calculateCosts = () => {
    const tenants = rentals.map(r => ({
      ...r,
      kWh: Number(r.kWh) || 0,
      remaining: Number(r.kWh) || 0,
      tiers: {}
    }));

    let totalRemaining = tenants.reduce((sum, t) => sum + t.remaining, 0);
    const tierDetails = tiers.map(tier => {
      const tierCapacity = tier.to === Infinity ? Infinity : tier.to - tier.from + 1;
      let tierRemaining = Math.min(tierCapacity, totalRemaining);
      const initialTierRemaining = tierRemaining;

      // Reset tier usage for all tenants
      tenants.forEach(t => t.tiers[tier.id] = 0);

      while (tierRemaining > 0) {
        const activeTenants = tenants.filter(t => t.remaining > 0);
        if (activeTenants.length === 0) break;

        const share = tierRemaining / activeTenants.length;
        let allocated = 0;

        activeTenants.forEach(tenant => {
          const allocate = Math.min(tenant.remaining, share);
          tenant.tiers[tier.id] += allocate;
          tenant.remaining -= allocate;
          allocated += allocate;
        });

        tierRemaining -= allocated;
        totalRemaining -= allocated;
      }

      return {
        ...tier,
        usage: initialTierRemaining - tierRemaining,
        cost: (initialTierRemaining - tierRemaining) * tier.rate
      };
    });

    const rentalDetails = tenants.map(tenant => {
      let total = 0;
      const breakdown = tiers.map(tier => {
        const usage = tenant.tiers[tier.id] || 0;
        const cost = usage * tier.rate;
        total += cost;
        return { usage, rate: tier.rate, cost };
      });

      return {
        ...tenant,
        breakdown,
        total
      };
    });

    return {
      tierDetails,
      rentalDetails,
      totalCost: tierDetails.reduce((sum, t) => sum + t.cost, 0)
    };
  };

  const { tierDetails, rentalDetails, totalCost } = calculateCosts();

  // Export function
  const handleExport = async () => {
    if (!resultRef.current) return;
    
    const dataUrl = await toJpeg(resultRef.current, { quality: 0.95 });
    const link = document.createElement('a');
    link.download = 'electricity-bill-split.jpg';
    link.href = dataUrl;
    link.click();
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">TNB Bill Split Calculator</h1>

      {/* Tier Configuration */}
      <div className="card bg-base-200 mb-4">
        <div className="card-body">
          <h2 className="card-title">Electricity Tiers</h2>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>From (kWh)</th>
                  <th>To (kWh)</th>
                  <th>Rate (RM)</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map(tier => (
                  <tr key={tier.id}>
                    <td>
                      <input
                        type="number"
                        className="input input-bordered input-sm"
                        value={tier.from}
                        onChange={(e) => updateTier(tier.id, 'from', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="input input-bordered input-sm"
                        value={tier.to}
                        onChange={(e) => updateTier(tier.id, 'to', e.target.value)}
                        disabled={tier.to === Infinity}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.001"
                        className="input input-bordered input-sm"
                        value={tier.rate}
                        onChange={(e) => updateTier(tier.id, 'rate', e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-sm mt-2" onClick={addTier}>
            Add Tier
          </button>
        </div>
      </div>

      {/* Rentals Input */}
      <div className="card bg-base-200 mb-4">
        <div className="card-body">
          <h2 className="card-title">Rental Units</h2>
          <div className="space-y-2">
            {rentals.map((rental) => (
              <div key={rental.id} className="flex gap-2 items-center">
                <input
                  type="text"
                  placeholder="Unit name"
                  className="input input-bordered flex-1"
                  value={rental.name}
                  onChange={(e) => updateRental(rental.id, 'name', e.target.value)}
                />
                <input
                  type="number"
                  placeholder="kWh"
                  className="input input-bordered w-32"
                  value={rental.kWh}
                  onChange={(e) => updateRental(rental.id, 'kWh', e.target.value)}
                />
                <button
                  className="btn btn-square btn-sm btn-error"
                  onClick={() => setRentals(rentals.filter(r => r.id !== rental.id))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button className="btn btn-sm mt-2" onClick={addRental}>
            Add Rental Unit
          </button>
        </div>
      </div>

      {/* Calculation Results */}
      {rentals.length > 0 && (
        <div className="card bg-base-200" ref={resultRef}>
          <div className="card-body">
            <h2 className="card-title">Calculation Results</h2>
            
            {/* Tier Breakdown */}
            <div className="mb-4">
              <h3 className="font-bold mb-2">Electricity Cost Breakdown</h3>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tier Range</th>
                      <th>Total kWh</th>
                      <th>Rate</th>
                      <th>Total Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tierDetails.map((tier, i) => (
                      <tr key={i}>
                        <td>
                          {tier.from} - {tier.to === Infinity ? '∞' : tier.to}
                        </td>
                        <td>{tier.usage.toFixed(2)}</td>
                        <td>RM{tier.rate.toFixed(3)}</td>
                        <td>RM{tier.cost.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-right font-bold mt-2">
                Total Cost: RM{totalCost.toFixed(2)}
              </div>
            </div>

            {/* Rental Shares */}
            <div>
              <h3 className="font-bold mb-2">Rental Unit Shares</h3>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Unit</th>
                      <th>Total kWh</th>
                      <th>Cost Breakdown</th>
                      <th>Total Payable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rentalDetails.map((rental, i) => (
                      <tr key={i}>
                        <td>{rental.name || `Unit ${i + 1}`}</td>
                        <td>{rental.kWh.toFixed(2)}</td>
                        <td>
                          <div className="text-xs">
                            {rental.breakdown.map((tier, j) => (
                              tier.usage > 0 && (
                                <div key={j}>
                                  {tier.usage.toFixed(2)} kWh × RM{tier.rate.toFixed(3)}
                                </div>
                              )
                            ))}
                          </div>
                        </td>
                        <td className="font-bold">
                          RM{rental.total.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <button className="btn btn-primary mt-4" onClick={handleExport}>
              Export as Image
            </button>
          </div>
        </div>
      )}
    </div>
  );
}