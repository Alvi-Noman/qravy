import { Link } from 'react-router-dom';
import Logo from './Logo';

export default function AuthErrorScreen({
  title = 'Session Expired',
  message = 'Your session has timed out for security reasons. Please log in again to continue.',
  action = 'Log In Again',
}: {
  title?: string;
  message?: string;
  action?: string;
}) {
  return (
    <div className="min-h-screen w-full bg-[#fcfcfc] flex flex-col font-inter px-4">
      <div className="w-full max-w-md flex flex-col items-center mx-auto mt-32 sm:mt-60">
        <Logo />
        <div className="w-full flex flex-col items-center">
          <h2 className="text-xl font-medium mb-6 text-[#2e2e30] text-center">{title}</h2>
          <p className="text-base text-[#5b5b5d] mb-8 text-center max-w-xs">{message}</p>
          <Link
            to="/login"
            className="text-[#2e2f30] text-sm hover:underline font-medium"
          >
            {action}
          </Link>
        </div>
      </div>
    </div>
  );
}
