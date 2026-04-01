import Svg, { Circle, Line, Path } from 'react-native-svg';

const SIZE = 24;
const props = { width: SIZE, height: SIZE, viewBox: '0 0 24 24', fill: 'none' };

export function FinanceIcon({ color }: { color: string }) {
  return (
    <Svg {...props}>
      <Line x1="12" y1="1" x2="12" y2="23" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function TravelIcon({ color }: { color: string }) {
  return (
    <Svg {...props}>
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={1.5} />
      <Path d="M2 12h20" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke={color} strokeWidth={1.5} />
    </Svg>
  );
}

export function HealthIcon({ color }: { color: string }) {
  return (
    <Svg {...props}>
      <Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ResearchIcon({ color }: { color: string }) {
  return (
    <Svg {...props}>
      <Circle cx="11" cy="11" r="8" stroke={color} strokeWidth={1.5} />
      <Line x1="21" y1="21" x2="16.65" y2="16.65" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

export const ICON_MAP: Record<string, (props: { color: string }) => React.JSX.Element> = {
  Finance: FinanceIcon,
  Travel: TravelIcon,
  Health: HealthIcon,
  Research: ResearchIcon,
};
