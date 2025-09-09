import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import StepWelcome from '../features/restaurant-accounts/onboarding/StepWelcome';
import StepLocation from '../features/restaurant-accounts/onboarding/StepLocation';
import StepTableCount from '../features/restaurant-accounts/onboarding/StepTableCount';

export default function Welcome() {
  const { token, user, loading } = useAuthContext();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Guards: must be logged in; skip if already onboarded
  useEffect(() => {
    if (loading) return;
    if (!token) navigate('/login', { replace: true });
    if (user?.isOnboarded) navigate('/dashboard', { replace: true });
  }, [loading, token, user, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      {step === 0 && <StepWelcome onNext={() => setStep(1)} />}
      {step === 1 && <StepLocation onNext={() => setStep(2)} onBack={() => setStep(0)} />}
      {step === 2 && <StepTableCount onBack={() => setStep(1)} />}
    </div>
  );
}