import { useState, useRef, useEffect } from 'react';
import { toJpeg } from 'html-to-image';
import { Calculator, Delete, User, X, Zap } from 'lucide-react';
import { evaluate, round } from 'mathjs';
import { twMerge } from 'tailwind-merge';
import toast from 'react-hot-toast';
import LZString from 'lz-string';

const defaultTiers = [
  { id: '1', from: 1, to: 200, rate: 0.218 },
  { id: '2', from: 201, to: 300, rate: 0.334 },
  { id: '3', from: 301, to: 600, rate: 0.516 },
  { id: '4', from: 601, to: Infinity, rate: 0.546 },
];

const icptRates = {
  domestic: [
    { max: 600, rate: -0.02, label: '≤600 kWh (Rebate)' },
    { max: 1500, rate: 0, label: '601-1500 kWh' },
    { max: Infinity, rate: 0.10, label: '>1500 kWh' }
  ],
  nonDomestic: {
    lv: 0.027,
    mv_hv: 0.16,
    streetlight: 0.09,
    water: 0.027
  }
};

export default function App() {
  const [tiers, setTiers] = useState(defaultTiers);
  const [rentals, setRentals] = useState([{ id: 1, name: '', kWh: '' }, { id: 2, name: '', kWh: '' }]);
  const [serviceTaxRate, setServiceTaxRate] = useState(8);
  const [customerType, setCustomerType] = useState('domestic');
  const [icptCategory, setIcptCategory] = useState('lv');
  const [showCalculator, setShowCalculator] = useState(null);
  const [calcValue, setCalcValue] = useState('');
  const resultRef = useRef(null);
  const [paramsLoaded, setParamsLoaded] = useState(false);

  // Tier management functions
  const addTier = () => {
    const newTier = {
      id: Date.now().toString(),
      from: tiers[tiers.length - 1].from + 1,
      to: tiers[tiers.length - 1].from + 1,
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

  // Rental management functions
  const addRental = () => {
    setRentals([...rentals, { id: Date.now().toString(), name: '', kWh: '' }]);
  };

  const updateRental = (id, field, value) => {
    setRentals(rentals.map(rental =>
      rental.id === id ? { ...rental, [field]: value } : rental
    ));
  };

  // Calculator functions
  const handleCalcInput = (value) => {
    if (value === 'C') {
      setCalcValue(prev => prev.split("").splice(0, prev.length - 1).join(""));
    } else {
      setCalcValue(prev => prev + value);
    }
  };

  // Add this function to compress state
  const compressState = (state) => {
    const processed = JSON.stringify(state, (key, value) => {
      if (typeof value === 'number' && !isFinite(value)) {
        return { __type: 'Infinity' };
      }
      return value;
    });
    return LZString.compressToEncodedURIComponent(processed);
  };

  const decompressState = (compressed) => {
    try {
      return JSON.parse(
        LZString.decompressFromEncodedURIComponent(compressed),
        (key, value) => {
          // Restore Infinity
          if (value?.__type === 'Infinity') return Infinity;
          return value;
        }
      );
    } catch {
      return null;
    }
  };

  const generateShareLink = () => {
    const state = {
      t: tiers.map(({ id, ...rest }) => rest), // Remove UUIDs
      r: rentals.map(({ id, calculation, ...rest }) => rest),
      str: serviceTaxRate,
      ct: customerType,
      ic: icptCategory
    };
    return `${window.location.origin}${window.location.pathname}?s=${compressState(state)}`;
  };
  const handleShare = async () => {
    const link = generateShareLink();
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied to clipboard!');
    } catch (err) {
      toast.error('Failed to copy link');
    }
  };

  const applyCalculation = (unitId) => {
    try {
      const result = round(evaluate(calcValue), 4)
      if (!isNaN(result)) {
        setRentals(rentals.map(rental =>
          rental.id === unitId ? {
            ...rental,
            kWh: result,
            calculation: calcValue
          } : rental
        ));
      }
    } catch {
      toast.error("Invalid Calculation.")
    }
    setShowCalculator(null);
    setCalcValue('');
  };

  // Calculation logic
  const calculateCosts = () => {
    const tenants = rentals.map(r => ({
      ...r,
      kWh: Number(r.kWh) || 0,
      remaining: Number(r.kWh) || 0,
      tiers: {}
    }));

    let totalKWh = tenants.reduce((sum, t) => sum + t.kWh, 0);
    let totalRemaining = tenants.reduce((sum, t) => sum + t.remaining, 0);
    const tierDetails = tiers.map(tier => {
      const tierCapacity = tier.to === Infinity ? Infinity : tier.to - tier.from + 1;
      let tierRemaining = Math.min(tierCapacity, totalRemaining);
      const initialTierRemaining = tierRemaining;

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

    // Calculate ICPT
    let icpt = 0;
    if (customerType === 'domestic') {
      const domesticRate = icptRates.domestic.find(r => totalKWh <= r.max);
      icpt = totalKWh * domesticRate.rate;
    } else {
      icpt = totalKWh * icptRates.nonDomestic[icptCategory];
    }

    // Calculate Service Tax
    let serviceTax = 0;
    if (totalKWh > 600) {
      const taxableAmount = tierDetails.reduce((sum, t) => sum + t.cost, 0) + icpt;
      serviceTax = taxableAmount * (serviceTaxRate / 100);
    }

    const rentalDetails = tenants.map(tenant => {
      let baseTotal = 0;
      const breakdown = tiers.map(tier => {
        const usage = tenant.tiers[tier.id] || 0;
        const cost = usage * tier.rate;
        baseTotal += cost;
        return { usage, rate: tier.rate, cost };
      });

      const tenantRatio = tenant.kWh / totalKWh;
      const tenantIcpt = icpt * tenantRatio;
      const tenantTax = serviceTax * tenantRatio;

      return {
        ...tenant,
        breakdown,
        baseTotal,
        icpt: tenantIcpt,
        serviceTax: tenantTax,
        total: baseTotal + tenantIcpt + tenantTax
      };
    });

    return {
      tierDetails,
      rentalDetails,
      totalCost: tierDetails.reduce((sum, t) => sum + t.cost, 0) + icpt + serviceTax,
      icpt,
      serviceTax,
      totalKWh
    };
  };

  const { tierDetails, rentalDetails, totalCost, icpt, serviceTax, totalKWh } = calculateCosts();

  // Export function
  const handleExport = async () => {
    if (!resultRef.current) return;

    const dataUrl = await toJpeg(resultRef.current, { quality: 0.95 });
    const link = document.createElement('a');
    link.download = 'electricity-bill-split.jpg';
    link.href = dataUrl;
    link.click();
  };


  // Update your useEffect for loading parameters:
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const compressedState = searchParams.get('s');

    if (compressedState) {
      const state = decompressState(compressedState);
      if (state) {
        setTiers(
          (state.t || []).map((t, i) => ({
            ...t,
            id: Date.now().toString() + Math.random() + i, // Better ID regeneration
            to: typeof t.to === 'number' ? t.to : Infinity
          }))
        );

        setRentals((state.r || []).map((r, i) => ({
          ...r,
          id: Date.now().toString() + Math.random() + i, // Better ID regeneration
          calculation: r.calculation || undefined
        })));
        setServiceTaxRate(state.str || 8);
        setCustomerType(state.ct || 'domestic');
        setIcptCategory(state.ic || 'lv');
      }
    }

    setParamsLoaded(true);
  }, []);

  // At the top of your component
  if (!paramsLoaded) {
    return <div className="text-center p-8">Loading...</div>;
  }

  const tierConfiguration = (
    <div className="collapse bg-base-100 border-base-300 border collapse-arrow">
      <input type="checkbox" defaultChecked={false} />
      <div className="collapse-title font-semibold text-lg">Electricity Tiers</div>
      <div className="collapse-content">
        <div className='flex-center gap-4'>
          {
            tiers.map((tier, index) => {
              return (
                <div key={index} className='flex flex-col md:flex-row w-full items-center justify-between gap-2'>
                  <p className='text-3xl opacity-50 font-bold divider md:!gap-2 w-full md:w-12'>
                    <span className='inline md:hidden'>Tier </span>{String(index + 1).padStart(2, '0')}
                  </p>
                  <label className="input input-bordered flex items-center w-full gap-2">
                    <span className='opacity-50 w-12 md:w-auto'>
                      From
                    </span>
                    <div className="divider divider-horizontal m-0"></div>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder='(kWh)'
                      className='w-full'
                      value={tier.from}
                      onChange={(e) => updateTier(tier.id, 'from', e.target.value)}
                    />
                  </label>
                  <label className={twMerge("input input-bordered flex items-center w-full gap-2", tier.to === Infinity && "input-disabled")}>
                    <span className='opacity-50 w-12 md:w-auto'>
                      To
                    </span>
                    <div className="divider divider-horizontal m-0"></div>
                    {
                      tier.to === Infinity
                        ? '∞'
                        : <input
                          type="number"
                          inputMode="decimal"
                          placeholder='(kWh)'
                          className='w-full'
                          value={tier.to}
                          onChange={(e) => updateTier(tier.id, 'to', e.target.value)}
                        />
                    }

                  </label>
                  <label className="input input-bordered flex items-center w-full gap-2">
                    <span className='opacity-50 w-12 md:w-auto'>
                      Rate
                    </span>
                    <div className="divider divider-horizontal m-0"></div>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.001"
                      placeholder='(MYR)'
                      className='w-full'
                      value={tier.rate}
                      onChange={(e) => updateTier(tier.id, 'rate', e.target.value)}
                    />
                  </label>
                </div>
              )
            })
          }
          {/* <button className="btn btn-neutral w-full" onClick={addTier}>
            Add Tier
          </button> */}
          <p className='w-full text-end text-balance text-sm opacity-50'>
            Default Settings refer to the <a className='underline' target="_blank" href="https://www.tnb.com.my/residential/pricing-tariffs" rel="noreferrer">TNB Official Website</a> on <span className='bold'>Apr 15, 2025</span>
          </p>
        </div>
      </div>
    </div>
  )

  const rentalUnits = (
    <div className="collapse bg-base-100 border-base-300 border collapse-arrow">
      <input type="checkbox" defaultChecked={true} />
      <div className="collapse-title font-semibold text-lg">Rental Units</div>
      <div className="collapse-content">
        <div className="flex-center gap-2">
          {rentals.map((rental, index) => {
            return (
              <div key={index} className='flex flex-col md:flex-row w-full items-center justify-between gap-2'>
                <p className='text-3xl opacity-50 font-bold divider md:!gap-2 w-full md:w-12'>
                  <span className='inline md:hidden'>Rental </span>{String(index + 1).padStart(2, '0')}
                </p>
                <label className="input input-bordered flex items-center w-full gap-2">
                  <span className='opacity-50'>
                    Name
                  </span>
                  <div className="divider divider-horizontal m-0"></div>
                  <input
                    type="text"
                    placeholder='Rental Name / Unit Number'
                    className='w-full'
                    value={rental.name}
                    onChange={(e) => updateRental(rental.id, 'name', e.target.value)}
                  />
                </label>
                <div className="flex flex-row w-full md:w-auto gap-2">
                  <label className="input input-bordered flex items-center w-full md:w-auto gap-2">
                    <span className='opacity-50 flex-center md:aspect-square'>
                      <Zap size={16} />
                    </span>
                    <div className="divider divider-horizontal m-0"></div>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder='kWh'
                      className='w-full min-w-12'
                      value={rental.kWh}
                      onChange={(e) => updateRental(rental.id, 'kWh', e.target.value)}
                    />
                  </label>
                  <button
                    className="btn btn-square"
                    onClick={() => {
                      setCalcValue(rental.kWh || '');
                      setShowCalculator(rental.id);
                    }}
                  >
                    <Calculator size={24} />
                  </button>
                  <button
                    className="btn btn-square btn-error"
                    onClick={() => setRentals(rentals.filter(r => r.id !== rental.id))}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )
          })}
          <button className="btn btn-neutral w-full" onClick={addRental}>
            Add Rental Unit
          </button>
        </div>
      </div>
    </div>
  )

  const calculatorModal = (
    <div className={`modal modal-bottom md:modal-middle ${showCalculator ? 'modal-open' : ''}`}>
      <div className="modal-box flex-center gap-2 max-w-[30rem]">
        <h3 className="font-bold text-lg w-full self-start">Calculator</h3>
        <div class="flex-center gap-2 w-full">
          <input
            type="text"
            className="input input-bordered w-full"
            value={calcValue}
            onChange={(e) => setCalcValue(e.target.value)}
            placeholder='E.g: 200 - 100'
          />
          <div className="grid grid-cols-4 gap-2 w-full">
            {['7', '8', '9', '+', '4', '5', '6', '-', '1', '2', '3', '*', '.', '0', 'C', '/'].map((btn) => (
              <button
                key={btn}
                className={`btn btn-md text-lg ${btn === 'C' ? 'btn-error btn-outline' : ''}`}
                onClick={() => handleCalcInput(btn)}
              >
                {btn === 'C' ? <Delete className='-translate-x-[.5px]' /> : btn}
              </button>
            ))}
          </div>
        </div>
        <div className="modal-action w-full">
          <div className="flex w-full gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => setShowCalculator(null)}>
              Close
            </button>
            <button className="btn flex-1 btn-neutral" onClick={() => applyCalculation(showCalculator)}>
              Apply
            </button>
          </div>
        </div>
      </div>
      <div className="modal-backdrop" onClick={() => setShowCalculator(null)}>
      </div>
    </div>
  )

  const additionalChargesConfg = (
    <div className="collapse bg-base-100 border-base-300 border collapse-arrow">
      <input type="checkbox" defaultChecked={false} />
      <div className="collapse-title font-semibold text-lg">Additional Charges</div>
      <div className="collapse-content">
        <div className="flex-center gap-2">
          <label className="border rounded-md w-full flex items-center gap-2">
            <p className="md:min-w-36 opacity-50 text-nowrap pl-4">
              Customer Type
            </p>
            <div className="divider divider-horizontal m-0"></div>
            <select
              className="select w-full"
              value={customerType}
              onChange={(e) => setCustomerType(e.target.value)}
            >
              <option value="domestic">Domestic (Tariff A)</option>
              <option value="nonDomestic">Non-Domestic</option>
            </select>
          </label>

          {customerType === 'nonDomestic' && (
            <label className="border rounded-md w-full flex items-center gap-2">
              <p className="md:min-w-36 opacity-50 text-nowrap pl-4">ICPT Category</p>
              <div className="divider divider-horizontal m-0"></div>
              <select
                className="w-full select"
                value={icptCategory}
                onChange={(e) => setIcptCategory(e.target.value)}
              >
                <option value="lv">LV Commercial/Industrial & Water</option>
                <option value="mv_hv">MV/HV Commercial/Industrial</option>
                <option value="streetlight">Streetlight (Local Auth)</option>
              </select>
            </label>
          )}

          <label className="input input-bordered flex items-center w-full gap-2">
            <p className='opacity-50 flex-center text-nowrap'>
              Service Tax
            </p>
            <div className="divider divider-horizontal m-0"></div>
            <input
              type="number"
              inputMode="decimal"
              placeholder='%'
              className='w-full min-w-12 text-end'
              value={serviceTaxRate}
              onChange={(e) => setServiceTaxRate(e.target.value)}
            />
            <p>
              %
            </p>
          </label>
        </div>
      </div>
    </div>
  )

  const result = (
    <div className='w-full flex-center bg-base-100 gap-2' ref={resultRef}>
      <div className='flex-center w-full gap-2'>
        <div className='flex-center border rounded-3xl w-full p-5 gap-2'>
          <p className='w-full text-lg font-semibold opacity-80'>Electricity Cost Breakdown</p>
          <div className="divider m-0" />
          <div className="flex flex-col md:flex-row w-full gap-2">
            <div className='flex-center gap-2 w-full md:w-auto md:flex-1 max-w-[20rem]'>
              {tierDetails.map((tier, index) => {
                return (
                  <div key={index} className='flex flex-col gap-2 w-full'>
                    <p className='flex items-center gap-2 font-bold'>
                      Tier: <span className="min-w-12 block text-center leading-tight badge badge-outline badge-sm">{tier.from}</span> ~ <span className="min-w-12 block text-center leading-tight badge badge-outline badge-sm">{tier.to === Infinity ? '∞' : tier.to}</span>
                    </p>
                    <div className="flex items-center text-nowrap justify-end w-full gap-2">
                      <p className='opacity-80'>{tier.usage.toFixed(2)} kWh * RM{tier.rate.toFixed(3)} = </p>
                      <p className='font-bold'>RM{tier.cost.toFixed(2)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="divider md:divider-horizontal m-0" />
            <div className='flex-center p-4 md:flex-1'>
              <p className='opacity-50 font-bold w-full text-start md:text-center'>
                Total Base Cost
              </p>
              <p className='text-5xl font-bold opacity-80 py-4 md:p-0'>
                RM{tierDetails.reduce((sum, t) => sum + t.cost, 0).toFixed(2)}
              </p>

            </div>
          </div>
        </div>
        <div className='flex-center border rounded-3xl w-full p-5'>
          <p className='w-full text-lg font-semibold'>Additional Charges / Discount</p>
          <div className='flex-center w-full gap-2'>
            <div className="flex flex-row w-full justify-between text-nowrap">
              <span className='truncate'>
                ICPT (
                {customerType === 'domestic' ?
                  `Domestic: ${icptRates.domestic.find(r => totalKWh <= r.max).label}` :
                  `Non-Domestic: ${icptCategory.toUpperCase()}`
                }
                )
              </span>
              <span className='font-bold text-end self-end'> - RM{icpt.toFixed(2).replace("-", "")}</span>
            </div>
            {totalKWh > 600 && (
              <div className="flex flex-row w-full justify-between text-nowrap">
                <span>Service Tax ({serviceTaxRate}%)</span>
                <span className="font-bold text-end self-end"> + RM{serviceTax.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
        <div className='flex-center border rounded-3xl w-full p-5 bg-current'>
          <p className='w-full text-lg font-semibold text-base-100'>Total Paid</p>
          <div className='flex-center w-full gap-2 text-base-100 py-4'>
            <p className="flex-center text-5xl font-bold text-base-100">
              RM{(tierDetails.reduce((sum, t) => sum + t.cost, 0) + icpt + serviceTax).toFixed(2)}
            </p>
          </div>
        </div>
        <div className='flex-center border rounded-3xl w-full p-5 gap-2'>
          <p className='w-full text-lg font-semibold'>Rental Unit Shares</p>
          {rentalDetails.map((rental, index) => (
            <div key={index} className='flex w-full gap-2 flex-col md:flex-row justify-between border p-2 rounded-lg'>
              <div className='w-full flex flex-col'>
                <div className="flex flex-row gap-2 items-center">
                  <div className="flex-center aspect-square rounded-full border w-16">
                    <User className="opacity-50" size={36} />
                  </div>
                  <div className='flex flex-col'>
                    <p className='font-bold text-lg'>{rental.name || `Unit ${index + 1}`}</p>
                    <p className='leading-tight opacity-80'>Total used: {rental.kWh.toFixed(2)} kWh</p>
                  </div>
                </div>

                <div className='flex-center items-start p-2 gap-1'>
                  <p className='font-bold'>Cost Break Down:</p>
                  <ol>
                    {rental.breakdown.map((tier, jndex) => (
                      tier.usage > 0 && (
                        <li key={jndex} className='text-sm'>
                          {tier.usage.toFixed(2)} kWh × RM{tier.rate.toFixed(3)}
                        </li>
                      )
                    ))}
                  </ol>
                  <div className="divider w-auto m-0" />
                  <p className="flex w-full">
                    <span>
                      Base Cost:
                    </span>
                    <div className="flex-1" />
                    <span className="font-bold">
                      RM{rental.baseTotal.toFixed(2)}
                    </span>
                  </p>
                  <br />
                  <p className='font-bold'>Additional Charges / Discount:</p>
                  <ul>
                    {
                      rental.icpt !== 0 &&
                      <li className="text-sm">
                        ICPT: RM{rental.icpt.toFixed(2)}
                      </li>
                    }
                    {
                      rental.serviceTax !== 0 &&
                      <li className='text-sm'>
                        Tax: RM{rental.serviceTax.toFixed(2)}
                      </li>
                    }
                  </ul>
                </div>
              </div>
              <div className="divider divider-horizontal m-0" />
              <div className='flex-center w-full md:min-w-[10rem] md:w-auto rounded-md bg-base-200 p-4'>
                <p>Total</p>
                <p className='text-lg font-bold'>RM{(rental.total || 0).toFixed(2)}</p>
              </div>

            </div>
          ))}
        </div>
        {
          rentalDetails.filter((rd) => !!rd.calculation).length > 0 &&
          <div className='flex-center border rounded-3xl w-full p-5'>
            <p className='w-full text-lg font-semibold'>Remarks</p>
            <div className="w-full flex flex-col gap-2">
              {
                rentalDetails.map((rental, index) => {
                  return (
                    <div key={index} className=''>
                      {
                        rental.calculation && (
                          <p className="">
                            <span className="font-bold">
                              {rental.name || `Unit ${index + 1}`}
                            </span>
                            : {rental.kWh}kWh = {rental.calculation}
                          </p>
                        )
                      }
                    </div>
                  )
                })
              }
            </div>
          </div>
        }
      </div>
      <div className="flex flex-col gap-2 w-full">
        <div className="flex gap-2 w-full">
          {/* <button className="btn btn-primary flex-1" onClick={handleExport}>
            Export as Image
          </button> */}
          <button className="btn btn-primary flex-1" onClick={handleShare}>
            Share Link
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6 text-center">TNB Bill Split Calculator</h1>
      <div className="flex-center gap-2">
        {tierConfiguration}
        {rentalUnits} {calculatorModal}
        {additionalChargesConfg}
      </div>
      <div className="divider text-3xl font-bold">
        Result
      </div>
      {
        rentals.length > 0
          ? result
          : <button className="btn btn-ghost w-full" onClick={addRental}>
            Add Rental Unit to Continue
          </button>
      }
    </div>
  );
}